/**
 * API 适配器工厂
 *
 * 根据服务器配置创建对应的适配器实例，
 * 并提供全局单例访问
 */

import type { ServerConfig, MusicServerAdapter } from './types'
import { SubsonicAdapter } from './adapters/subsonic'
import { JellyfinAdapter } from './adapters/jellyfin'
import { EmbyAdapter } from './adapters/emby'

/** 当前激活的适配器实例 */
let currentAdapter: MusicServerAdapter | null = null

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
      })

    case 'jellyfin':
      return new JellyfinAdapter({
        url: config.url,
        token: config.token,
        userId: config.token, // userId 暂时复用，初始化时会更新
      })

    case 'emby':
      return new EmbyAdapter({
        url: config.url,
        token: config.token,
        userId: config.token,
      })

    default:
      throw new Error(`Unsupported server type: ${config.type}`)
  }
}

/** 设置当前激活的适配器 */
export function setActiveAdapter(adapter: MusicServerAdapter): void {
  currentAdapter = adapter
}

/** 获取当前激活的适配器，不存在时抛出异常 */
export function getAdapter(): MusicServerAdapter {
  if (!currentAdapter) {
    throw new Error('No active server adapter. Please connect to a music server first.')
  }
  return currentAdapter
}

/** 检查是否有激活的适配器 */
export function hasAdapter(): boolean {
  return currentAdapter !== null
}

/** 清除当前适配器（登出时调用）*/
export function clearAdapter(): void {
  currentAdapter = null
}

// 重导出类型和适配器类，方便外部使用
export type { MusicServerAdapter }
export { SubsonicAdapter, JellyfinAdapter, EmbyAdapter }
