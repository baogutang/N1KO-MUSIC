/**
 * 服务器连接状态管理
 * 负责管理多服务器配置、当前激活服务器、认证状态
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ServerConfig, ServerType } from '@/api/types'
import { createAdapter, setActiveAdapter, clearAdapter } from '@/api'
import { queryClient } from '@/lib/queryClient'

interface ServerState {
  /** 已配置的服务器列表 */
  servers: ServerConfig[]
  /** 当前激活服务器 ID */
  activeServerId: string | null
  /** 是否已连接 */
  isConnected: boolean
  /** 当前用户名 */
  username: string | null
  /** 用户头像 URL */
  avatarUrl: string | null

  // --- Actions ---
  /** 添加或更新服务器配置 */
  addServer: (config: Omit<ServerConfig, 'id' | 'createdAt'>) => string
  /** 删除服务器配置 */
  removeServer: (id: string) => void
  /** 激活指定服务器（初始化适配器）*/
  /** 激活服务器；返回是否成功（失效的旧版 Jellyfin/Emby 凭据会返回 false 并要求重新登录）*/
  activateServer: (id: string) => boolean
  /** 登出并清除当前服务器 */
  disconnect: () => void
  /** 更新服务器认证信息（登录成功后调用）*/
  updateServerAuth: (id: string, token: string, salt?: string, userId?: string) => void
  /** 获取激活的服务器配置 */
  getActiveServer: () => ServerConfig | null
}

export const useServerStore = create<ServerState>()(
  persist(
    (set, get) => ({
      servers: [],
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
        set(state => {
          const servers = state.servers.filter(s => s.id !== id)
          const activeServerId = state.activeServerId === id ? null : state.activeServerId
          if (activeServerId === null && state.activeServerId === id) {
            clearAdapter()
            // 移除当前激活服务器时清空查询缓存，避免残留旧服务器数据
            queryClient.clear()
          }
          return { servers, activeServerId, isConnected: activeServerId !== null }
        })
      },

      activateServer: (id) => {
        const server = get().servers.find(s => s.id === id)
        if (!server) return false

        // 迁移：旧版本持久化的 Jellyfin/Emby 配置没有 userId（旧代码误用 token 充当 userId），
        // 无法构造可用的适配器，清除其凭据强制重新登录。
        // 注意：仅当该失效服务器本身是当前激活服务器时才断开连接，
        // 避免「切换到失效服务器却把正在使用的连接一并清掉」的悬空状态
        if ((server.type === 'jellyfin' || server.type === 'emby') && !server.userId) {
          const wasActive = get().activeServerId === id
          if (wasActive) {
            clearAdapter()
            queryClient.clear()
          }
          set(state => ({
            servers: state.servers.map(s => (s.id === id ? { ...s, token: '', isActive: false } : s)),
            ...(wasActive ? { activeServerId: null, isConnected: false } : {}),
          }))
          return false
        }

        try {
          const prevActiveId = get().activeServerId
          const adapter = createAdapter(server)
          setActiveAdapter(adapter)
          // 切换到不同服务器时清空查询缓存（查询 key 不含服务器 ID，否则会展示旧服务器数据）
          if (prevActiveId !== id) {
            queryClient.clear()
          }
          set({
            activeServerId: id,
            isConnected: true,
            username: server.username,
          })
          // 更新服务器的 isActive 标志
          set(state => ({
            servers: state.servers.map(s => ({ ...s, isActive: s.id === id })),
          }))
          return true
        } catch (err) {
          console.error('Failed to activate server adapter:', err)
          return false
        }
      },

      disconnect: () => {
        clearAdapter()
        // 登出时清空查询缓存，避免下次登录其他服务器时命中旧数据
        queryClient.clear()
        set({
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
      name: 'msp-server-store',
      // 不持久化 isConnected，每次刷新重新连接
      partialize: (state) => ({
        servers: state.servers,
        activeServerId: state.activeServerId,
        username: state.username,
      }),
      // 持久化后恢复时自动激活上次连接的服务器
      onRehydrateStorage: () => (state) => {
        if (state?.activeServerId) {
          // 同步激活 adapter
          state.activateServer(state.activeServerId)
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
  }
  return labels[type] ?? type
}
