/**
 * API 适配器注册表
 *
 * 多音源并存：一个 serverId 一个适配器实例；`getAdapter()` 返回主库
 * （原「当前激活服务器」）的适配器，语义见 PLAN.md §2 决定 6。
 * 播放引擎与一切「针对某首歌 / 专辑 / 歌单的操作」必须走
 * `getAdapterFor(item.serverId)`，不允许默认打主库。
 */

import type { ServerConfig, MusicServerAdapter } from './types'
import { SubsonicAdapter } from './adapters/subsonic'
import { JellyfinAdapter } from './adapters/jellyfin'
import { EmbyAdapter } from './adapters/emby'

/** 已连接音源的适配器注册表（serverId → adapter） */
const adapters = new Map<string, MusicServerAdapter>()
/** 主库 serverId：决定 getAdapter() 返回谁 */
let primaryServerId: string | null = null

/**
 * 根据服务器配置创建适配器实例
 */
export function createAdapter(config: ServerConfig): MusicServerAdapter {
  switch (config.type) {
    case 'subsonic':
    case 'navidrome':
      return new SubsonicAdapter({
        url: config.url,
        username: config.username,
        token: config.token,
        salt: config.salt ?? '',
        serverId: config.id,
      })

    case 'jellyfin':
      return new JellyfinAdapter({
        url: config.url,
        token: config.token,
        userId: config.userId ?? '',
        serverId: config.id,
      })

    case 'emby':
      return new EmbyAdapter({
        url: config.url,
        token: config.token,
        userId: config.userId ?? '',
        serverId: config.id,
      })

    // 插件音源装载沙箱是异步的，不走 createAdapter：
    // 见 plugins/host/pluginRuntime.ts 与 serverStore.connectServer
    default:
      throw new Error(`Unsupported server type: ${config.type}`)
  }
}

/** 注册一个已连接音源的适配器 */
export function registerAdapter(serverId: string, adapter: MusicServerAdapter): void {
  adapters.set(serverId, adapter)
}

/** 注销音源适配器；若它正是主库，主库一并清空 */
export function unregisterAdapter(serverId: string): void {
  adapters.delete(serverId)
  if (primaryServerId === serverId) primaryServerId = null
}

/**
 * 取某个音源的适配器，未注册时抛错。
 * 用于播放、收藏、歌单操作等「必须打对服务器」的路径。
 */
export function getAdapterFor(serverId: string): MusicServerAdapter {
  const adapter = adapters.get(serverId)
  if (!adapter) {
    throw new Error(`No adapter registered for server: ${serverId}`)
  }
  return adapter
}

/** 该音源是否已连接 */
export function hasAdapterFor(serverId?: string): boolean {
  if (serverId) return adapters.has(serverId)
  return primaryServerId !== null
}

/**
 * 封面等展示路径的宽容取法：缺 serverId 时回退主库，
 * 未连接返回 null 而不是抛错——封面打不开不该连坐整个页面。
 */
export function findAdapterFor(serverId?: string): MusicServerAdapter | null {
  if (serverId) return adapters.get(serverId) ?? null
  if (!primaryServerId) return null
  return adapters.get(primaryServerId) ?? null
}

/** 全部已连接音源 */
export function listAdapters(): Array<{ serverId: string; adapter: MusicServerAdapter }> {
  return Array.from(adapters.entries(), ([serverId, adapter]) => ({ serverId, adapter }))
}

/** 把主库切到某个**已注册**的音源 */
export function setPrimary(serverId: string): void {
  if (!adapters.has(serverId)) {
    throw new Error(`Cannot set primary: server not registered: ${serverId}`)
  }
  primaryServerId = serverId
}

/** 获取主库适配器，不存在时抛出异常 */
export function getAdapter(): MusicServerAdapter {
  const adapter = primaryServerId ? adapters.get(primaryServerId) : undefined
  if (!adapter) {
    throw new Error('No active server adapter. Please connect to a music server first.')
  }
  return adapter
}

/** 是否有已连接的主库 */
export function hasAdapter(): boolean {
  return primaryServerId !== null && adapters.has(primaryServerId)
}

/** 清空全部适配器（登出时调用）*/
export function clearAdapter(): void {
  adapters.clear()
  primaryServerId = null
}

// 重导出类型和适配器类，方便外部使用
export type { MusicServerAdapter }
export { SubsonicAdapter, JellyfinAdapter, EmbyAdapter }
