/**
 * 音源账号横幅（PLAN 1.6）：任一插件音源凭据失效（getUser 回 null）时
 * 顶部提示重新扫码——不静默失败（PLAN §2 决定 7）。
 *
 * 检查时机：挂载、窗口重新聚焦、每 5 分钟；有凭据的插件音源才查。
 */

import { useCallback, useEffect, useState } from 'react'
import { WarningCircle, ArrowRight } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { useServerStore } from '@/store/serverStore'
import { usePluginStore } from '@/plugins/host/pluginStore'
import { getPluginHost } from '@/plugins/host/pluginRuntime'
import { useT } from '@/i18n'
import type { PluginUser } from '@/plugins/types'

const CHECK_INTERVAL_MS = 5 * 60 * 1000

interface StaleSource {
  serverId: string
  /** 显示名：插件名（带账号后缀时去掉昵称） */
  name: string
}

export function SourceAccountBanner() {
  const { t } = useT()
  const navigate = useNavigate()
  const servers = useServerStore(s => s.servers)
  const connectedIds = useServerStore(s => s.connectedServerIds)
  const plugins = usePluginStore(s => s.plugins)
  const [stale, setStale] = useState<StaleSource[]>([])

  const check = useCallback(async () => {
    const pluginServers = servers.filter(
      s => s.type === 'plugin' && s.pluginId && s.credentials && connectedIds.includes(s.id)
    )
    const results = await Promise.all(
      pluginServers.map(async (server): Promise<StaleSource | null> => {
        const host = getPluginHost(server.id)
        if (!host || !host.hasMethod('n1ko.auth.getUser')) return null
        try {
          const user = await host.call<PluginUser | null>('n1ko.auth.getUser')
          // 有凭据但 getUser 判定无效（null）= 需要重新登录
          return user === null ? { serverId: server.id, name: pluginLabel(server.name, server.pluginId, plugins) } : null
        } catch {
          // 探测失败不横幅（可能是瞬时网络问题），下次再查
          return null
        }
      })
    )
    setStale(results.filter((r): r is StaleSource => r !== null))
  }, [servers, connectedIds, plugins])

  useEffect(() => {
    void check()
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
    const onFocus = () => void check()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [check])

  if (!stale.length) return null

  return (
    <button
      onClick={() => navigate('/login')}
      className="flex w-full items-center justify-between gap-3 border-b border-hair bg-paper-deep/70 px-4 py-2 text-left pop:border-b-0 pop:bg-surface"
    >
      <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-soft">
        <WarningCircle size={15} className="flex-shrink-0 text-primary" weight="fill" />
        <span className="truncate">
          {t('sources.banner.expired', { names: stale.map(s => s.name).join('、') })}
        </span>
      </span>
      <span className="flex flex-shrink-0 items-center gap-1 text-[12px] font-medium text-primary">
        {t('sources.banner.relogin')}
        <ArrowRight size={12} />
      </span>
    </button>
  )
}

/** 服务器名是「插件名 · 昵称」，横幅里显示插件名即可对上设置页 */
function pluginLabel(serverName: string, pluginId: string | undefined, plugins: Array<{ id: string; name: string }>): string {
  if (pluginId) {
    const installed = plugins.find(p => p.id === pluginId)
    if (installed) return installed.name
  }
  return serverName.split(' · ')[0] ?? serverName
}
