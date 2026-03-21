/**
 * Emby API 适配器
 *
 * Emby 与 Jellyfin API 高度相似（同源），
 * 本适配器继承 JellyfinAdapter 并覆写差异部分
 */

import axios from 'axios'
import type { ServerType, AuthResult } from '../types'
import { JellyfinAdapter } from './jellyfin'

export class EmbyAdapter extends JellyfinAdapter {
  override readonly type: ServerType = 'emby'

  /**
   * Emby 认证流程与 Jellyfin 略有不同：
   * - 端点为 /Users/AuthenticateByName（相同）
   * - 响应字段名称相同
   * - API Key 存储于 X-Emby-Token header
   */
  override async login(url: string, username: string, password: string): Promise<AuthResult> {
    const cleanUrl = url.replace(/\/$/, '')
    try {
      const resp = await axios.post(
        `${cleanUrl}/Users/AuthenticateByName`,
        { Username: username, Pw: password },
        {
          headers: {
            'X-Emby-Authorization':
              'MediaBrowser Client="MusicStreamPro", Device="Web", DeviceId="msp-web-emby", Version="1.0.0"',
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      )
      const data = resp.data
      return {
        success: true,
        token: data.AccessToken,
        userId: data.User?.Id,
        username: data.User?.Name,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection failed'
      return { success: false, token: '', error: message }
    }
  }
}
