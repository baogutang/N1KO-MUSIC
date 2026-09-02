/**
 * 服务器连接状态管理
 * 负责管理多服务器配置、当前激活服务器、认证状态
 */

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
import { usePlayerStore } from '@/store/playerStore'
import { createSecurePersistStorage } from '@/store/securePersistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'

/** persist 实际写盘的那一份，storage 适配器按它的形状加解密 */
type PersistedServerState = Pick<ServerState, 'servers' | 'activeServerId' | 'username'>

interface ServerState {
  /** 已配置的服务器列表 */
  servers: ServerConfig[]
  /** 已连接（注册了适配器）的服务器 ID，多源并存 */
  connectedServerIds: string[]
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
  /** 连接单个服务器（注册适配器，不改主库）；返回是否成功 */
  connectServer: (id: string) => boolean
  /** 断开单个服务器（注销适配器；若是主库则清空主库）*/
  disconnectServer: (id: string) => void
  /** 把主库切到某个已连接的服务器 */
  setPrimaryServer: (id: string) => boolean
  /**
   * 连接并设为主库。旧语义保留：登录页「快速连接」与添加新服务器走这里。
   * 返回是否成功（失效的旧版 Jellyfin/Emby 凭据会返回 false 并要求重新登录）。
   */
  activateServer: (id: string) => boolean
  /** 登出并断开所有服务器 */
  disconnect: () => void
  /** 更新服务器认证信息（登录成功后调用）*/
  updateServerAuth: (id: string, token: string, salt?: string, userId?: string) => void
  /** 获取主库配置 */
  getActiveServer: () => ServerConfig | null
}

export const useServerStore = create<ServerState>()(
  persist(
    (set, get) => ({
      servers: [],
      connectedServerIds: [],
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
        const removingActiveServer = get().activeServerId === id
        if (removingActiveServer) {
          usePlayerStore.getState().resetForServerChange()
        }
        unregisterAdapter(id)
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

      connectServer: (id) => {
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
          registerAdapter(id, createAdapter(server))
          set(state => ({
            connectedServerIds: state.connectedServerIds.includes(id)
              ? state.connectedServerIds
              : [...state.connectedServerIds, id],
          }))
          return true
        } catch (err) {
          console.error('Failed to connect server adapter:', err)
          return false
        }
      },

      disconnectServer: (id) => {
        const wasPrimary = get().activeServerId === id
        unregisterAdapter(id)
        set(state => ({
          connectedServerIds: state.connectedServerIds.filter(x => x !== id),
          servers: state.servers.map(s => (s.id === id ? { ...s, isActive: false } : s)),
        }))
        if (wasPrimary) {
          usePlayerStore.getState().resetForServerChange()
          queryClient.clear()
          set({ activeServerId: null, isConnected: false, username: null, avatarUrl: null })
        }
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

      activateServer: (id) => {
        if (!get().connectServer(id)) return false
        return get().setPrimaryServer(id)
      },

      disconnect: () => {
        usePlayerStore.getState().resetForServerChange()
        clearAdapter()
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
      // 持久化后恢复：把所有 autoConnect 的服务器都连上，再恢复主库
      onRehydrateStorage: () => (state) => {
        if (!state) return
        for (const server of state.servers) {
          if (server.autoConnect === false) continue
          state.connectServer(server.id)
        }
        if (state.activeServerId) {
          state.setPrimaryServer(state.activeServerId)
        }
      },
    }
  )
)

// 辅助：根据类型获取服务器图标文字
export function getServerTypeLabel(type: ServerType): string {
  const labels: Record<ServerType, string> = {
    subsonic: 'Subsonic',
    navidrome: 'Navidrome',
    jellyfin: 'Jellyfin',
    emby: 'Emby',
    plugin: 'Plugin',
  }
  return labels[type] ?? type
}
