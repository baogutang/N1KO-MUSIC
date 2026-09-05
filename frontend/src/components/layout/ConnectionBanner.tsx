/**
 * 离线 / 服务器不可达 / 音源登录失效 / 插件异常，全站唯一的一条状态横幅。
 *
 * 此前拔掉服务器只有一个会自动消失的 toast，之后每个页面要么渲染陈旧缓存
 * 要么空白，用户没有任何持续可见的线索，也没有重试入口。
 * 这里做成一条常驻的发丝线横幅——不遮挡内容，但不会自己消失。
 *
 * 「音源登录失效」原本另有一条 SourceAccountBanner，只挂在桌面布局上：
 * 手机端因此从来看不到过期提示，而桌面上两条横幅并排、各自轮询同一个登录
 * 接口、文案还不一样。那条已经删掉，职责并到这里——探测（120 秒 + 标签页
 * 可见性门）本来就已经在这个文件里了，缺的只是手机端的挂载与一个关闭出口。
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowsClockwise, WifiSlash, Key, Warning, X } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { getAdapter, getAdapterFor, hasAdapter, hasAdapterFor } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** 浏览器报离线后多久探一次服务器 */
const PROBE_INTERVAL_MS = 20_000
/** 插件音源凭据体检间隔（会打到真实登录接口，放慢） */
const CREDENTIAL_PROBE_INTERVAL_MS = 120_000

/**
 * 本次会话里被「暂不」关掉的插件（按 pluginId 记，同一插件的多个账号一起静音）。
 *
 * 刻意用模块级 Set 而不是 localStorage：这条提示说的是「你的登录坏了」，
 * 永久静音等于把问题藏起来；刷新一次重新出现是对的。
 */
const dismissedPlugins = new Set<string>()

/** 从横幅进「重新登录」：直达该插件的扫码步，不再把人扔回登录页首页 */
export function reloginPath(pluginId: string | undefined): string {
  return pluginId ? `/login?plugin=${encodeURIComponent(pluginId)}&relogin=1` : '/login'
}

/**
 * 同一时刻只显示一条横幅，这里定下先后。抽成纯函数是为了能被单测钉住。
 *
 * 「插件异常」排在离线之前：它不会自己好（沙箱已经因越界被拆），重试按钮
 * 也救不回来，唯一出口是去设置里重装插件；离线则往往几秒后自愈。
 */
export type BannerKind = 'compromised' | 'offline' | 'sourceAuth' | null
export function pickBanner(input: { compromised: number; offline: boolean; expired: number }): BannerKind {
  if (input.compromised > 0) return 'compromised'
  if (input.offline) return 'offline'
  if (input.expired > 0) return 'sourceAuth'
  return null
}

/** 登录失效的音源：名字用来说清是哪个，pluginId 用来跳对扫码页 */
interface ExpiredSource {
  id: string
  name: string
  pluginId?: string
}

/** 三条横幅同一副外形：一条发丝线上的一句话加一个出口 */
const BANNER_CLASS =
  'flex items-center justify-center gap-3 border-b border-hair bg-paper-deep px-4 py-1.5 text-[12px] text-ink-soft'
const ACTION_CLASS =
  'inline-flex items-center gap-1 border-b border-ink-soft pb-px text-ink transition-colors duration-200 hover:border-primary hover:text-primary'

export function ConnectionBanner() {
  const { t } = useT()
  const activeServerId = useServerStore(s => s.activeServerId)
  const [browserOffline, setBrowserOffline] = useState(() => !navigator.onLine)
  const [serverUnreachable, setServerUnreachable] = useState(false)
  /**
   * 凭据失效要和网络不通分开。
   *
   * 在别的设备上改了密码之后，这里原本会说「检查网络连接」，而重试按钮
   * 永远救不回来——用户被指向一个不存在的问题。这一态的正确出口是
   * 重新登录，不是重试。
   */
  const [unauthorized, setUnauthorized] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    const online = () => setBrowserOffline(false)
    const offline = () => setBrowserOffline(true)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  // 浏览器在线不代表家里的 NAS 可达：断网的常见形态是离开了家里的网络
  useEffect(() => {
    if (!activeServerId || !hasAdapter()) return
    let cancelled = false
    const probe = async () => {
      try {
        const adapter = getAdapter()
        // diagnose 是可选方法；没有它的适配器退回 ping 的二值语义
        const verdict = adapter.diagnose
          ? await adapter.diagnose()
          : (await adapter.ping()) ? 'ok' as const : 'unreachable' as const
        if (cancelled) return
        setUnauthorized(verdict === 'unauthorized')
        setServerUnreachable(verdict === 'unreachable')
      } catch {
        if (!cancelled) { setUnauthorized(false); setServerUnreachable(true) }
      }
    }
    // 挂载时先探一次：否则断网后最长要等 20 秒才有任何提示
    void probe()
    const timer = setInterval(() => {
      // 标签页在后台时不必轮询，回到前台会立刻补一次
      if (document.visibilityState === 'hidden') return
      void probe()
    }, PROBE_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void probe() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [activeServerId])

  const retry = useCallback(async () => {
    setRetrying(true)
    try {
      if (hasAdapter()) {
        const adapter = getAdapter()
        const verdict = adapter.diagnose
          ? await adapter.diagnose()
          : (await adapter.ping()) ? 'ok' as const : 'unreachable' as const
        setUnauthorized(verdict === 'unauthorized')
        setServerUnreachable(verdict === 'unreachable')
        if (verdict === 'ok') await queryClient.refetchQueries({ type: 'active' })
      }
      setBrowserOffline(!navigator.onLine)
    } finally {
      setRetrying(false)
    }
  }, [queryClient])

  const offline = browserOffline || serverUnreachable || unauthorized

  /*
   * 沙箱越界被停用的音源（serverStore 的运行时状态，见 markServerCompromised）。
   * 只留还在配置里的：源被删掉之后这条提示就没有对象了。
   */
  const servers = useServerStore(s => s.servers)
  const compromisedIds = useServerStore(s => s.compromisedServerIds)
  const compromisedSources = compromisedIds
    .map(id => servers.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
  /** 主库本身是插件音源时，「登录失效」要说流媒体那一套话 */
  const primaryPluginServer = servers.find(s => s.id === activeServerId && s.type === 'plugin') ?? null

  /**
   * 逐源凭据体检（验收第三轮 #10）：非主库的插件音源也各自问一次
   * n1ko.auth.getUser（匿名浏览按健康处理）。流媒体 Cookie 的半衰期是
   * 「周」，过期后的表现是收藏/推荐悄悄消失——必须有一条常驻可见的
   * 「请重新登录」出口。选择器吐 join 后的字符串保持引用稳定。
   */
  const pluginIds = useServerStore(s => s.connectedServerIds
    .filter(id => {
      const server = s.servers.find(v => v.id === id)
      return server?.type === 'plugin' && id !== s.activeServerId
    })
    .sort()
    .join('|'))
  const [expiredSources, setExpiredSources] = useState<ExpiredSource[]>([])

  useEffect(() => {
    const ids = pluginIds ? pluginIds.split('|') : []
    if (!ids.length) {
      setExpiredSources(prev => (prev.length ? [] : prev))
      return
    }
    let cancelled = false
    const probeSources = async () => {
      const bad: ExpiredSource[] = []
      for (const id of ids) {
        if (!hasAdapterFor(id)) continue
        const adapter = getAdapterFor(id)
        if (!adapter.diagnose) continue
        const server = () => useServerStore.getState().servers.find(s => s.id === id)
        try {
          if ((await adapter.diagnose()) === 'unauthorized') {
            const found = server()
            bad.push({ id, name: found?.name ?? id, pluginId: found?.pluginId })
          }
        } catch (err) {
          /*
           * 探测本身抛错：只有插件按协议报 unauthorized 才算「登录失效」，
           * 其余（网络、超时）当瞬时故障，下一轮再说。
           *
           * 此前这里是个光秃秃的 catch——插件老老实实抛 unauthorized 时横幅
           * 反而不出现，凭据坏了却全站无声，正是这条链路最初要解决的问题。
           */
          if ((err as { code?: string } | null)?.code === 'unauthorized') {
            const found = server()
            bad.push({ id, name: found?.name ?? id, pluginId: found?.pluginId })
          }
        }
      }
      if (!cancelled) setExpiredSources(bad)
    }
    void probeSources()
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      void probeSources()
    }, CREDENTIAL_PROBE_INTERVAL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void probeSources() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pluginIds])

  /*
   * 「暂不」关掉的插件本次会话不再提。
   *
   * 两步都要做：进 dismissedPlugins（120 秒后的下一轮体检还会把它探出来，
   * 靠这个 Set 挡住），再从当前 state 里摘掉（这一次立刻消失）。
   * 有多个源过期时只静音被关掉的那一个，其余照常提示。
   */
  const visibleExpired = expiredSources.filter(s => !(s.pluginId && dismissedPlugins.has(s.pluginId)))
  const dismiss = (source: ExpiredSource) => {
    if (source.pluginId) dismissedPlugins.add(source.pluginId)
    setExpiredSources(prev => prev.filter(s => s !== source))
  }

  switch (pickBanner({
    compromised: compromisedSources.length,
    offline,
    expired: visibleExpired.length,
  })) {
    case 'compromised':
      return renderCompromisedBanner()
    case 'offline':
      return renderOfflineBanner()
    case 'sourceAuth':
      return renderSourceAuthBanner()
    default:
      return null
  }

  /** 沙箱越界被停用的音源：重试与重新登录都救不回来，出口是重装插件 */
  function renderCompromisedBanner() {
    const names = compromisedSources.map(s => s.name).join('、')
    return (
      <div role="status" aria-live="polite" className={BANNER_CLASS}>
        <Warning size={13} aria-hidden="true" className="text-destructive flex-shrink-0" />
        <span>
          {t('sources.banner.compromised', { names })}
          <span className="text-ink-faint">{t('sources.banner.compromisedHint')}</span>
        </span>
        <button onClick={() => navigate('/settings')} className={ACTION_CLASS}>
          <ArrowsClockwise size={11} aria-hidden="true" />
          {t('sources.banner.reinstall')}
        </button>
      </div>
    )
  }

  /** 插件音源的扫码凭据过期：直达该插件的扫码步，并给一个会话级「暂不」 */
  function renderSourceAuthBanner() {
    const names = visibleExpired.map(s => s.name).join('、')
    const first = visibleExpired[0]
    return (
      <div role="status" aria-live="polite" className={BANNER_CLASS}>
        <Key size={13} aria-hidden="true" className="text-primary flex-shrink-0" />
        <span>
          {t('empty.offline.sourceAuth', { names })}
          {/* 插件音源的失效原因是扫码凭据过期，不是「密码改了」——
              那句提示是给自建服务器写的，套到流媒体音源上是误导 */}
          <span className="text-ink-faint">{t('empty.offline.sourceAuthHint')}</span>
        </span>
        <button onClick={() => navigate(reloginPath(first.pluginId))} className={ACTION_CLASS}>
          <Key size={11} aria-hidden="true" />
          {t('sources.banner.relogin')}
        </button>
        <button
          onClick={() => dismiss(first)}
          aria-label={t('sources.banner.dismiss')}
          title={t('sources.banner.dismiss')}
          className="inline-flex items-center gap-1 text-ink-faint transition-colors duration-200 hover:text-ink"
        >
          <X size={11} aria-hidden="true" />
          {t('sources.banner.dismiss')}
        </button>
      </div>
    )
  }

  function renderOfflineBanner() {
    const showAuth = unauthorized && !browserOffline
    /*
     * 主库是插件音源时，「密码可能已更改」是错的：流媒体音源没有密码，
     * 坏掉的是扫码凭据。文案与出口都要跟着换，否则用户被指向一个
     * 根本不存在的操作。
     */
    const primaryPlugin = showAuth ? primaryPluginServer : null
    const message = primaryPlugin ? t('empty.offline.sourceAuth', { names: primaryPlugin.name })
      : showAuth ? t('empty.offline.auth')
      : browserOffline ? t('empty.offline.device') : t('empty.offline.server')
    const hint = primaryPlugin ? t('empty.offline.sourceAuthHint')
      : showAuth ? t('empty.offline.authHint')
      : browserOffline ? t('empty.offline.deviceHint') : t('empty.offline.serverHint')

    return (
      <div role="status" aria-live="polite" className={BANNER_CLASS}>
        {showAuth
          ? <Key size={13} aria-hidden="true" className="text-primary flex-shrink-0" />
          : <WifiSlash size={13} aria-hidden="true" className="text-primary flex-shrink-0" />}
        <span>
          {message}
          <span className="text-ink-faint">{hint}</span>
        </span>
        {showAuth ? (
          <button
            onClick={() => navigate(primaryPlugin ? reloginPath(primaryPlugin.pluginId) : '/login')}
            className={ACTION_CLASS}
          >
            <Key size={11} aria-hidden="true" />
            {primaryPlugin ? t('sources.banner.relogin') : t('empty.offline.reauth')}
          </button>
        ) : (
          <button onClick={retry} disabled={retrying} className={cn(ACTION_CLASS, 'disabled:opacity-50')}>
            <ArrowsClockwise size={11} className={retrying ? 'animate-spin' : undefined} aria-hidden="true" />
            {t('action.retry')}
          </button>
        )}
      </div>
    )
  }
}
