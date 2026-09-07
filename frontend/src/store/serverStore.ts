/**
 * 服务器连接状态管理
 * 负责管理多服务器配置、当前激活服务器、认证状态
 */

import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ServerConfig, ServerType } from '@/api/types'
import {
  clearAdapter,
  createAdapter,
  registerAdapter,
  setPrimary,
  unregisterAdapter,
} from '@/api'
import { queryClient } from '@/lib/queryClient'
import { t } from '@/i18n'
import { usePlayerStore } from '@/store/playerStore'
import { useSettingsStore } from '@/store/settingsStore'
import { createSecurePersistStorage } from '@/store/securePersistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'
import { disposePluginHost, ensurePluginHost, createPluginAdapterFor } from '@/plugins/host/pluginRuntime'
import type { PluginHost } from '@/plugins/host/PluginHost'
import { usePluginStore } from '@/plugins/host/pluginStore'

/** persist 实际写盘的那一份，storage 适配器按它的形状加解密 */
type PersistedServerState = Pick<ServerState, 'servers' | 'activeServerId' | 'username'>

interface ServerState {
  /** 已配置的服务器列表 */
  servers: ServerConfig[]
  /** 已连接（注册了适配器）的服务器 ID，多源并存 */
  connectedServerIds: string[]
  /**
   * 插件沙箱越界（ready 之后自己导航走）被强制停用的音源 ID。
   *
   * 与 connectedServerIds 同一类东西：运行时的连接状态，不落盘——重启后插件
   * 重新装载，是好是坏由那一次的沙箱说了算，不该把上一次的判决带进新会话。
   */
  compromisedServerIds: string[]
  /**
   * 启动时的自动连接（onRehydrateStorage 那一轮）是否已经走完。
   *
   * 插件音源装载沙箱要几秒，这几秒里 hasAdapterFor(插件源) 是 false——
   * 播放引擎若据此判定「音源已断开」，会在每次冷启动时把用户上次听的那首
   * 跳掉、弹一条错误、还自动开播。没走完之前「没适配器」只意味着「还没连上」。
   * 运行时状态，不落盘。
   */
  startupConnectSettled: boolean
  /** 主库 ID（原「激活服务器」）：决定默认浏览页与 getAdapter() 返回谁 */
  activeServerId: string | null
  /** 是否已连接（有主库）*/
  isConnected: boolean
  /** 当前用户名 */
  username: string | null
  /** 用户头像 URL */
  avatarUrl: string | null

  // --- Actions ---
  /** 添加或更新服务器配置 */
  addServer: (config: Omit<ServerConfig, 'id' | 'createdAt'>) => string
  /** 删除服务器配置（同时注销其适配器）*/
  removeServer: (id: string) => void
  /** 连接单个服务器（注册适配器，不改主库）；插件音源要装载沙箱，是异步的 */
  connectServer: (id: string) => Promise<boolean>
  /** 断开单个服务器（注销适配器；若是主库则清空主库）*/
  disconnectServer: (id: string) => void
  /**
   * 插件沙箱越界：断开该音源并记下「插件异常，已停用」。
   * PluginHost 侦测到自导航时已经自拆沙箱，这里负责让这件事在界面上看得见。
   */
  markServerCompromised: (id: string, reason: string) => void
  /** 把主库切到某个已连接的服务器 */
  setPrimaryServer: (id: string) => boolean
  /**
   * 连接并设为主库。旧语义保留：登录页「快速连接」与添加新服务器走这里。
   * 返回是否成功（失效的旧版 Jellyfin/Emby 凭据会返回 false 并要求重新登录）。
   */
  activateServer: (id: string) => Promise<boolean>
  /** 登出并断开所有服务器 */
  disconnect: () => void
  /** 更新服务器认证信息（登录成功后调用）*/
  updateServerAuth: (id: string, token: string, salt?: string, userId?: string) => void
  /** 插件音源凭据回写（env.setCredentials / 重新登录产生新串时）*/
  updateServerCredentials: (id: string, credentials: string | null) => void
  /** 插件音源重复登录时原地更新账号身份与凭据，避免同一插件堆出多行 */
  updatePluginServer: (
    id: string,
    patch: { name?: string; username?: string; credentials?: string | null }
  ) => void
  /** 获取主库配置 */
  getActiveServer: () => ServerConfig | null
}

export const useServerStore = create<ServerState>()(
  persist(
    (set, get) => ({
      servers: [],
      connectedServerIds: [],
      compromisedServerIds: [],
      startupConnectSettled: false,
      activeServerId: null,
      isConnected: false,
      username: null,
      avatarUrl: null,

      addServer: (config) => {
        const id = `server_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
        const newServer: ServerConfig = {
          ...config,
          id,
          createdAt: Date.now(),
        }
        set(state => ({ servers: [...state.servers, newServer] }))
        return id
      },

      removeServer: (id) => {
        disposePluginHost(id)
        unregisterAdapter(id)
        /*
         * 队列按来源裁剪，而不是整条清空（PLAN §4.4）。
         *
         * 原来只有「删的正好是主库」才动播放器，且动作是 resetForServerChange：
         * 一边让删掉插件源的歌永远卡在队列里（点到就是静默不动），
         * 一边让删掉主库时把别的源的歌一起清掉。两个方向都错。
         */
        usePlayerStore.getState().removeSongsFromServer(id)
        // 播放优先级里的死 id 同步清掉：resolveSourceOrder 虽能容忍，
        // 但下次在设置页调排序时会按「只写已连接源」把用户的旧偏好静默丢掉
        useSettingsStore.getState().prunePlaybackPriority([id])
        set(state => {
          const servers = state.servers.filter(s => s.id !== id)
          const activeServerId = state.activeServerId === id ? null : state.activeServerId
          if (activeServerId === null && state.activeServerId === id) {
            // 移除主库时清空查询缓存，避免残留旧服务器数据
            queryClient.clear()
          }
          return {
            servers,
            connectedServerIds: state.connectedServerIds.filter(x => x !== id),
            activeServerId,
            isConnected: activeServerId !== null,
          }
        })
      },

      connectServer: async (id) => {
        const server = get().servers.find(s => s.id === id)
        if (!server) return false

        // 迁移：旧版本持久化的 Jellyfin/Emby 配置没有 userId（旧代码误用 token 充当 userId），
        // 无法构造可用的适配器，清除其凭据强制重新登录。
        // 注意：仅当该失效服务器本身是主库时才断开连接，
        // 避免「切到失效服务器却把正在使用的连接一并清掉」的悬空状态
        if ((server.type === 'jellyfin' || server.type === 'emby') && !server.userId) {
          const wasPrimary = get().activeServerId === id
          if (wasPrimary) {
            usePlayerStore.getState().resetForServerChange()
            unregisterAdapter(id)
            queryClient.clear()
          }
          set(state => ({
            servers: state.servers.map(s => (s.id === id ? { ...s, token: '', isActive: false } : s)),
            connectedServerIds: state.connectedServerIds.filter(x => x !== id),
            ...(wasPrimary ? { activeServerId: null, isConnected: false } : {}),
          }))
          return false
        }

        try {
          if (server.type === 'plugin') {
            // 插件音源：装载沙箱（异步）→ 按 manifest 挂能力的适配器
            const host = await ensurePluginHost(server)
            registerAdapter(id, createPluginAdapterFor(id, host.manifest, host))
            void refreshPluginProfile(id, host)
          } else {
            registerAdapter(id, createAdapter(server))
          }
          set(state => ({
            connectedServerIds: state.connectedServerIds.includes(id)
              ? state.connectedServerIds
              : [...state.connectedServerIds, id],
            // 重装插件后重新连上了 = 上一次的「沙箱越界」判决作废。
            // 不清的话「插件异常，已停用」会一直挂在横幅上，即使源已经好了。
            compromisedServerIds: state.compromisedServerIds.filter(x => x !== id),
          }))
          return true
        } catch (err) {
          console.error('Failed to connect server adapter:', err)
          return false
        }
      },

      disconnectServer: (id) => {
        const wasPrimary = get().activeServerId === id
        disposePluginHost(id)
        unregisterAdapter(id)
        // 适配器没了，这个源的歌就取不到流了：把它们从队列与历史里摘掉，
        // 当前曲若正是它的则前进到下一首（PLAN §4.4「断开某个音源时从队列里移除它的曲目」）。
        // 只裁这一个源——混源队列里别人的歌不该被连坐。
        usePlayerStore.getState().removeSongsFromServer(id)
        set(state => ({
          connectedServerIds: state.connectedServerIds.filter(x => x !== id),
          servers: state.servers.map(s => (s.id === id ? { ...s, isActive: false } : s)),
        }))
        if (wasPrimary) {
          queryClient.clear()
          set({ activeServerId: null, isConnected: false, username: null, avatarUrl: null })
        }
      },

      markServerCompromised: (id, reason) => {
        /*
         * 沙箱已经在 PluginHost 里自拆了，这个音源此刻既没有适配器也没有沙箱。
         * 界面上要有两件事发生，否则用户看到的只是「这个源忽然什么都搜不到」：
         *  1. 按正常断开处理——注销适配器、是主库就让出主库；
         *  2. 记一条不落盘的标记，让横幅与音源设置能说清「插件异常，已停用」。
         * 复用 disconnectServer 而不是自己再写一遍断开逻辑：主库让位、
         * 播放器重置、缓存清理这些副作用只该有一处定义。
         */
        console.error(`[sources] 插件沙箱越界，已停用音源 ${id}：${reason}`)
        get().disconnectServer(id)
        set(state => ({
          compromisedServerIds: state.compromisedServerIds.includes(id)
            ? state.compromisedServerIds
            : [...state.compromisedServerIds, id],
        }))
      },

      setPrimaryServer: (id) => {
        if (!get().connectedServerIds.includes(id)) return false
        const prevActiveId = get().activeServerId
        try {
          setPrimary(id)
        } catch (err) {
          console.error('Failed to set primary server:', err)
          return false
        }
        // 切换主库对播放器意味着换库：清队列、清缓存
        if (prevActiveId !== id) {
          usePlayerStore.getState().resetForServerChange()
          // 查询 key 已按服务器隔离；切换时仍清理 blob URL 等会话资源，控制内存占用。
          queryClient.clear()
        }
        const server = get().servers.find(s => s.id === id)
        set({
          activeServerId: id,
          isConnected: true,
          username: server?.username ?? null,
        })
        // 更新服务器的 isActive 标志
        set(state => ({
          servers: state.servers.map(s => ({ ...s, isActive: s.id === id })),
        }))
        return true
      },

      activateServer: async (id) => {
        if (!(await get().connectServer(id))) return false
        return get().setPrimaryServer(id)
      },

      disconnect: () => {
        usePlayerStore.getState().resetForServerChange()
        clearAdapter()
        // 登出全部必须拆掉每个插件沙箱（removeServer/disconnectServer 都拆，这里不能漏）：
        // 否则带凭据的 iframe 与消息监听在「已登出」后继续存活，仍能让宿主代发请求
        for (const id of [...get().connectedServerIds]) {
          disposePluginHost(id)
        }
        // 登出时清空查询缓存，避免下次登录其他服务器时命中旧数据
        queryClient.clear()
        set({
          connectedServerIds: [],
          activeServerId: null,
          isConnected: false,
          username: null,
          avatarUrl: null,
        })
      },

      updateServerAuth: (id, token, salt, userId) => {
        set(state => ({
          servers: state.servers.map(s =>
            s.id === id ? { ...s, token, salt: salt ?? s.salt, userId: userId ?? s.userId } : s
          ),
        }))
      },

      updateServerCredentials: (id, credentials) => {
        set(state => ({
          servers: state.servers.map(s => (s.id === id ? { ...s, credentials: credentials ?? undefined } : s)),
        }))
      },

      updatePluginServer: (id, patch) => {
        set(state => ({
          servers: state.servers.map(s =>
            s.id === id
              ? {
                  ...s,
                  ...(patch.name !== undefined ? { name: patch.name } : {}),
                  ...(patch.username !== undefined ? { username: patch.username } : {}),
                  ...(patch.credentials !== undefined ? { credentials: patch.credentials ?? undefined } : {}),
                }
              : s
          ),
        }))
      },

      getActiveServer: () => {
        const { servers, activeServerId } = get()
        return servers.find(s => s.id === activeServerId) ?? null
      },
    }),
    {
      name: STORAGE_KEYS.serverStore,
      /**
       * 凭据加密后落盘（设备密钥见 services/deviceKey.ts），底层仍是同步写入：
       * 进程被杀不能丢。
       *
       * 代价是 rehydrate 变成异步的——Web Crypto 只有异步接口。因此路由守卫
       * 必须先等 hasHydrated，否则会在解密完成前把已登录用户踢去登录页。
       */
      storage: createSecurePersistStorage<PersistedServerState>({
        collect: state => state.servers.flatMap(server => [
          ...(server.token ? [[`${server.id}:token`, server.token] as [string, string]] : []),
          ...(server.salt ? [[`${server.id}:salt`, server.salt] as [string, string]] : []),
          // 插件凭据同样只以密文落盘（阶段 1 登录流程会写入）
          ...(server.credentials ? [[`${server.id}:credentials`, server.credentials] as [string, string]] : []),
        ]),
        apply: (state, values) => ({
          ...state,
          servers: state.servers.map(server => {
            const token = values.get(`${server.id}:token`)
            const salt = values.get(`${server.id}:salt`)
            const credentials = values.get(`${server.id}:credentials`)
            return {
              ...server,
              ...(token !== undefined ? { token } : {}),
              ...(salt !== undefined ? { salt } : {}),
              ...(credentials !== undefined ? { credentials } : {}),
            }
          }),
        }),
      }) as never,
      // 不持久化 isConnected / connectedServerIds，每次刷新重新连接
      partialize: (state) => ({
        servers: state.servers,
        activeServerId: state.activeServerId,
        username: state.username,
      }),
      // 持久化后恢复：把所有 autoConnect 的服务器都连上，再恢复主库。
      // 插件音源装载沙箱是异步的，整体在后台异步执行
      onRehydrateStorage: () => (state) => {
        if (!state) {
          // 没有持久化状态（首次启动）：没有东西要连，直接算「已走完」
          useServerStore.setState({ startupConnectSettled: true })
          return
        }
        void (async () => {
          try {
            /*
             * 先给盘上恢复出来的旧曲目补来源，再连服务器。
             * v1.10.0 写下的队列里没有 serverId（那时它还是可选的、也没人写），
             * 而 v1.11.0 起取流、收藏、徽标都按来源路由。
             */
            if (state.activeServerId) {
              usePlayerStore.getState().adoptLegacySongSource(state.activeServerId)
            }
            for (const server of state.servers) {
              if (server.autoConnect === false) continue
              await state.connectServer(server.id)
            }
            if (state.activeServerId) {
              state.setPrimaryServer(state.activeServerId)
            }
          } finally {
            useServerStore.setState({ startupConnectSettled: true })
          }
        })()
      },
    }
  )
)

/**
 * 连上插件音源后把账号昵称补进清单。
 *
 * 登录页在扫码成功那一刻拿不到昵称：预登录沙箱的凭据是空的，问它 getUser
 * 只会得到 null，于是设置页与登录页的账号列一直写着「未登录」，而用户明明
 * 刚扫完码。真正带凭据的沙箱在这里才第一次活过来，问一次就够；取不到
 * （风控、超时）就保持原样，绝不把已登录的行改成「未登录」。
 */
async function refreshPluginProfile(id: string, host: PluginHost): Promise<void> {
  const server = useServerStore.getState().servers.find(s => s.id === id)
  if (!server?.credentials || !host.hasMethod('n1ko.auth.getUser')) return
  try {
    const user = await Promise.race([
      host.call<{ name?: string } | null>('n1ko.auth.getUser'),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 6000)),
    ])
    const nickname = user?.name?.trim()
    if (!nickname || nickname === server.username) return
    const pluginName = usePluginStore.getState().plugins.find(p => p.id === server.pluginId)?.name
    // 名字还是裸的插件名（登录时没拿到昵称）才补上「· 昵称」，用户改过的名字不动
    const name = pluginName && server.name === pluginName ? `${pluginName} · ${nickname}` : undefined
    useServerStore.getState().updatePluginServer(id, { username: nickname, ...(name ? { name } : {}) })
  } catch {
    /* 昵称只是锦上添花 */
  }
}

/**
 * 收听记录的读取范围：所有已连接的音源，主库排在最前。
 *
 * 历史 / 统计 / 本期 / 推荐画像问的是「我听了什么」，不是「主库上我听了什么」。
 * 一个音源刚断开时它的历史仍在本地，这里不包含它——页面只呈现当下连着的世界，
 * 与「断开的源不出现在界面上」保持一致。
 */
export function useHistoryScope(): string[] {
  const connected = useServerStore(state => state.connectedServerIds)
  const primary = useServerStore(state => state.activeServerId)
  return useMemo(() => {
    const ids = connected.length ? connected : (primary ? [primary] : [])
    if (!primary) return ids
    return [primary, ...ids.filter(id => id !== primary)]
  }, [connected, primary])
}

// 辅助：根据类型获取服务器图标文字
/**
 * 服务器类型的显示名。
 *
 * 四种 NAS 类服务端是产品名（Subsonic / Navidrome / …），产品名不翻译。
 * 但 'plugin' 不是产品名，是我们自己造的内部类型；它此前直接落到界面上写着
 * 「Plugin」——一个英文的实现细节词，中文界面上尤其突兀，用户也不知道
 * 「插件」和「服务器」在这里是什么关系。改走词条，并统一到全站的说法：
 * 界面上「服务器」只指 NAS 类服务端，插件一律叫「音源」。
 *
 * 这里用模块级 t() 而不是 useT()：调用方有的是组件、有的是普通函数
 * （Login 的 toast 文案），做成 hook 反而逼着后者绕路。代价是切语言后
 * 已经算出的字符串不会自动更新——而切语言本来就会重挂整棵树。
 */
export function getServerTypeLabel(type: ServerType): string {
  if (type === 'plugin') return t('sources.typeLabel')
  const labels: Record<Exclude<ServerType, 'plugin'>, string> = {
    subsonic: 'Subsonic',
    navidrome: 'Navidrome',
    jellyfin: 'Jellyfin',
    emby: 'Emby',
  }
  return labels[type] ?? type
}
