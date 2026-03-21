/**
 * 服务器连接状态管理
 * 负责管理多服务器配置、当前激活服务器、认证状态
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ServerConfig, ServerType } from '@/api/types'
import { createAdapter, setActiveAdapter, clearAdapter } from '@/api'

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
  activateServer: (id: string) => void
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
          }
          return { servers, activeServerId, isConnected: activeServerId !== null }
        })
      },

      activateServer: (id) => {
        const server = get().servers.find(s => s.id === id)
        if (!server) return

        try {
          const adapter = createAdapter(server)
          setActiveAdapter(adapter)
          set({
            activeServerId: id,
            isConnected: true,
            username: server.username,
          })
          // 更新服务器的 isActive 标志
          set(state => ({
            servers: state.servers.map(s => ({ ...s, isActive: s.id === id })),
          }))
        } catch (err) {
          console.error('Failed to activate server adapter:', err)
        }
      },

      disconnect: () => {
        clearAdapter()
        set({
          activeServerId: null,
          isConnected: false,
          username: null,
          avatarUrl: null,
        })
      },

      updateServerAuth: (id, token, salt, _userId) => {
        set(state => ({
          servers: state.servers.map(s =>
            s.id === id ? { ...s, token, salt: salt ?? s.salt } : s
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
