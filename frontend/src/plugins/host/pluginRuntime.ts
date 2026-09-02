/**
 * 插件运行时登记处：一个插件音源（ServerConfig type='plugin'）一个活沙箱。
 *
 * serverStore.connectServer 对插件音源走这里：装载沙箱（IndexedDB 里的代码）
 * → 等 ready → 注册 PluginAdapter。凭据变更（插件 env.setCredentials 回写）经
 * onCredentialsChange 更新 serverStore（进加密落盘清单）。
 * 断开 / 移除音源、卸载插件时 disposePluginHost 拆沙箱。
 */

import pkg from '../../../package.json'
import { getLocale } from '@/i18n'
import { isNativePlatform, isTauriShell, nativeOS } from '@/lib/platform'
import type { ServerConfig } from '@/api/types'
import type { PluginManifest } from '../types'
import { PluginAdapter } from '@/api/adapters/plugin'
import { usePluginStore } from './pluginStore'
import { pluginStorageGet, pluginStorageSet } from './pluginStorage'
import { useServerStore } from '@/store/serverStore'
import { PluginHost } from './PluginHost'

interface LiveHost {
  host: PluginHost
  /** 装载时用的凭据串；不一致时（重新登录后）需要拆掉重建 */
  credentials: string | null
}

const liveHosts = new Map<string, LiveHost>()

function pluginPlatform(): 'ios' | 'android' | 'desktop' | 'web' {
  if (isNativePlatform) return nativeOS === 'ios' ? 'ios' : 'android'
  if (isTauriShell) return 'desktop'
  return 'web'
}

/** manifest.userVariables 的默认值（可配置表单随阶段 3 的插件一起上） */
function defaultUserVariables(manifest: PluginManifest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const variable of manifest.userVariables ?? []) {
    out[variable.key] = variable.default ?? (variable.type === 'select' ? variable.options?.[0] ?? '' : '')
  }
  return out
}

/** 已装载的沙箱（音源设置里看请求日志 / 方法表用） */
export function getPluginHost(serverId: string): PluginHost | undefined {
  return liveHosts.get(serverId)?.host
}

export function disposePluginHost(serverId: string): void {
  const live = liveHosts.get(serverId)
  if (live) {
    live.host.dispose()
    liveHosts.delete(serverId)
  }
}

/**
 * 取或建一个插件音源的沙箱。凭据与上次装载不一致（重新扫码）时拆旧建新。
 * 抛错（插件已卸载 / 沙箱超时）由调用方按连接失败处理。
 */
export async function ensurePluginHost(config: ServerConfig): Promise<PluginHost> {
  if (!config.pluginId) throw new Error(`Server ${config.id} has no pluginId`)

  const existing = liveHosts.get(config.id)
  if (existing && existing.credentials === (config.credentials ?? null)) {
    return existing.host
  }
  if (existing) {
    existing.host.dispose()
    liveHosts.delete(config.id)
  }

  const installed = await usePluginStore.getState().getInstalled(config.pluginId)
  if (!installed) throw new Error(`插件未安装或已卸载：${config.pluginId}`)
  const manifest = installed.manifest as unknown as PluginManifest

  const host = new PluginHost(manifest, {
    env: {
      appVersion: pkg.version,
      locale: getLocale(),
      platform: pluginPlatform(),
      userVariables: defaultUserVariables(manifest),
    },
    credentials: config.credentials ?? null,
    storage: { get: pluginStorageGet, set: pluginStorageSet },
    onCredentialsChange: next => {
      // 插件回写的新凭据立即落 serverStore（加密清单），下次启动直接可用
      useServerStore.getState().updateServerCredentials(config.id, next)
    },
  })
  await host.init(installed.code)
  liveHosts.set(config.id, { host, credentials: config.credentials ?? null })
  return host
}

/** 供 serverStore.connectServer 注册适配器用 */
export function createPluginAdapterFor(serverId: string, manifest: PluginManifest, host: PluginHost): PluginAdapter {
  return new PluginAdapter({ serverId, manifest, host })
}

// ---------------- 预登录会话（登录页扫码 / Cookie 用） ----------------

/** pluginId → auth 专用沙箱（不登记 serverId，凭据为空，只跑 auth 方法） */
const authHosts = new Map<string, PluginHost>()

/**
 * 打开一个插件的预登录沙箱：渲染二维码、轮询状态、getUser 都在这里跑。
 * 登录成功（或取消）后 closeAuthHost 释放。
 */
export async function openAuthHost(pluginId: string): Promise<PluginHost> {
  const existing = authHosts.get(pluginId)
  if (existing) return existing
  const installed = await usePluginStore.getState().getInstalled(pluginId)
  if (!installed) throw new Error(`插件未安装或已卸载：${pluginId}`)
  const manifest = installed.manifest as unknown as PluginManifest
  const host = new PluginHost(manifest, {
    env: {
      appVersion: pkg.version,
      locale: getLocale(),
      platform: pluginPlatform(),
      userVariables: defaultUserVariables(manifest),
    },
    credentials: null,
    storage: { get: pluginStorageGet, set: pluginStorageSet },
    // 预登录会话的凭据回写没有意义（还没 addServer），忽略
  })
  await host.init(installed.code)
  authHosts.set(pluginId, host)
  return host
}

export function closeAuthHost(pluginId: string): void {
  const host = authHosts.get(pluginId)
  if (host) {
    host.dispose()
    authHosts.delete(pluginId)
  }
}
