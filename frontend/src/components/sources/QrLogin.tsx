/**
 * 扫码登录（PLAN 1.6）：qrcode 库渲染 SVG，2 秒轮询，过期一键刷新。
 * 四种状态文字：等待扫描 / 已扫描，请在手机上确认 / 二维码已过期（刷新）/ 失败。
 *
 * 轮询是 setTimeout 链而不是 setInterval，理由见下面 pollLoop 的注释：
 * 后台标签页要停、慢请求不能叠、二维码自己的有效期要算数。
 *
 * manifest.auth.methods 声明多条链路时（如 QQ 音乐的 QQ / 微信扫码），
 * 顶部出一排分段切换：切换即换码，checkQr 的 key 自带方法前缀由插件分派
 * （协议 §3）。单链路插件不渲染切换，行为与从前一致。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { useT } from '@/i18n'
import type { PluginHost } from '@/plugins/host/PluginHost'
import type { PluginQrCheckResult } from '@/plugins/types'
import { PluginCallError } from '@/plugins/host/PluginHost'
import { safeResourceUrl } from '@/plugins/host/whitelist'
import { describeError } from '@/services/errors'
import { cn } from '@/lib/utils'

const POLL_INTERVAL_MS = 2000

type QrPhase = 'loading' | 'waiting' | 'scanned' | 'expired' | 'error'

/** expired 的机器码 → 文案 key（插件给的是 code，句子在 i18n 这边） */
const EXPIRED_REASONS: Record<string, string> = {
  wx_denied: 'sources.qr.denied',
  wx_no_code: 'sources.qr.noCode',
  netease_risk: 'sources.qr.risk',
}

/**
 * 已知方法 id → 宿主词表键。manifest 里第三方插件给的 labelKey 多半不在
 * 本应用词表里（t() 会原样回显键名）；认识的 id 用我们自己的词条，
 * 不认识的退回 labelKey，再不行显示 id 本身。
 */
const METHOD_LABEL_KEYS: Record<string, string> = {
  qq: 'sources.qr.method.qq',
  wx: 'sources.qr.method.wx',
}

function methodLabel(method: { id: string; labelKey: string }, t: (key: string) => string): string {
  const key = METHOD_LABEL_KEYS[method.id] ?? method.labelKey
  const translated = t(key)
  return translated === key ? method.id : translated
}

export function QrLogin({
  host,
  qrHint,
  onAuthorized,
}: {
  host: PluginHost
  qrHint?: string
  /** 拿到凭据串（confirmed）时回调，由登录页完成 addServer */
  onAuthorized: (credentials: string) => void
}) {
  const { t } = useT()
  const methods = host.manifest.auth?.methods
  const [activeMethod, setActiveMethod] = useState<string | undefined>(methods?.[0]?.id)
  const [phase, setPhase] = useState<QrPhase>('loading')
  /** 二维码统一以 <img> 渲染（服务端图或本地生成的 data URL） */
  const [qrImage, setQrImage] = useState('')
  const [errorText, setErrorText] = useState('')
  /** expired 时插件给的机器码（如微信被拒绝），映射成一句人话 */
  const [expiredReason, setExpiredReason] = useState('')
  const qrKeyRef = useRef<string | null>(null)
  const cancelledRef = useRef(false)
  /** 这张码本地算出来的到期时刻（毫秒时间戳）；插件没给 expiresIn 时为 null */
  const expiresAtRef = useRef<number | null>(null)

  /*
   * 取码请求代次（复审 A7）：快速切换 QQ/微信时，共享的 cancelledRef 会被
   * 新一次 startQr 复位成 false——晚到的旧 createQr 于是照样写 key 和图，
   * 显示的是微信码、轮询的却是 QQ 的 key。每个请求持自己的代次，
   * 回来时只认最新的。
   */
  const qrRequestIdRef = useRef(0)

  const startQr = useCallback(async (methodId?: string) => {
    const requestId = ++qrRequestIdRef.current
    cancelledRef.current = false
    setPhase('loading')
    setErrorText('')
    setExpiredReason('')
    setQrImage('')
    expiresAtRef.current = null
    try {
      const created = await host.call<{ key: string; content: string; expiresIn: number; qrImage?: string }>(
        'n1ko.auth.createQr',
        methodId
      )
      if (cancelledRef.current || requestId !== qrRequestIdRef.current) return
      qrKeyRef.current = created.key
      /*
       * expiresIn（秒）此前被整个丢掉了。二维码过期后不少平台的 checkQr 仍旧
       * 一律回 waiting——界面就一直停在「打开对应 App 扫描二维码」，用户扫了
       * 半天才发现扫的是一张废码。本地记一个到期时刻，到点自己切过期态，
       * 「刷新二维码」那个按钮才有机会出现。
       */
      expiresAtRef.current = created.expiresIn > 0 ? Date.now() + created.expiresIn * 1000 : null
      // 二维码图进的是主窗口的 <img>，请求由主窗口自己发——沙箱 CSP 管不到。
      // 只认 manifest hosts 内的 http(s)（QQ 的 ptqrshow 就是这种）与 data:
      // （本地生成的图，不出网）；否则当作插件没给图，退回本地生成。
      const safeQrImage = safeResourceUrl(created.qrImage, host.manifest.hosts, { allowDataMedia: true })
      if (safeQrImage) {
        // 服务端生成的二维码图（含扫描跳转地址，本地无法复刻）
        if (cancelledRef.current || requestId !== qrRequestIdRef.current) return
        setQrImage(safeQrImage)
      } else {
        // 统一走 data URL <img>：SVG 注入会带固有宽高，URL 变长时溢出方框
        const dataUrl = await QRCode.toDataURL(created.content, {
          margin: 2,
          width: 440,
        })
        if (cancelledRef.current || requestId !== qrRequestIdRef.current) return
        setQrImage(dataUrl)
      }
      setPhase('waiting')
    } catch (err) {
      if (cancelledRef.current || requestId !== qrRequestIdRef.current) return
      setPhase('error')
      setErrorText(describeError(err) ?? t('sources.qr.error'))
    }
  }, [host, t])

  useEffect(() => {
    void startQr(activeMethod)
    return () => {
      cancelledRef.current = true
    }
  }, [startQr, activeMethod])

  /** 分段切换：换链路就是换一张全新的码 */
  const switchMethod = (id: string) => {
    if (id === activeMethod) return
    setActiveMethod(id)
  }

  /*
   * 轮询；waiting / scanned 都继续，expired / confirmed / error 停。
   *
   * 原来是 setInterval(2s)，三个毛病：
   *  1. 标签页切到后台照打——扫码页放着不管就是一小时 1800 次登录接口请求，
   *     对平台侧看就是一台在轮询的机器人；
   *  2. 请求慢于 2 秒时下一发照样出去，几发并起来，越慢越挤；
   *  3. 二维码自己的有效期没人管（见 startQr 里的 expiresAtRef）。
   * 改成 setTimeout 链：一次结束才排下一次（天然串行），后台只空转不发请求，
   * 回到前台立刻补一次——不然用户切回来还要干等两秒。
   */
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'scanned') return
    const key = qrKeyRef.current
    if (!key) return

    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inFlight = false

    const schedule = () => {
      if (stopped) return
      timer = setTimeout(() => void tick(), POLL_INTERVAL_MS)
    }

    const tick = async () => {
      if (stopped || cancelledRef.current) return
      // 本地到期优先于任何轮询结果：平台过期后往往还在回 waiting
      if (expiresAtRef.current !== null && Date.now() >= expiresAtRef.current) {
        setPhase('expired')
        return
      }
      // 后台标签页只空转不打接口；in-flight 时也跳过这一拍，请求绝不叠发
      if (document.visibilityState === 'hidden' || inFlight) {
        schedule()
        return
      }
      inFlight = true
      try {
        const result = await host.call<PluginQrCheckResult>('n1ko.auth.checkQr', key)
        if (stopped || cancelledRef.current) return
        if (result.status === 'scanned') {
          setPhase('scanned')
          return
        }
        if (result.status === 'expired') {
          setExpiredReason(result.reason ?? '')
          setPhase('expired')
          return
        }
        if (result.status === 'confirmed' && result.credentials) {
          cancelledRef.current = true
          onAuthorized(result.credentials)
          return
        }
        // waiting：继续
      } catch (err) {
        if (stopped || cancelledRef.current) return
        // checkQr 本身报错（key 被消费 / 网络）按过期处理，可刷新重试
        if (err instanceof PluginCallError && err.code === 'not-found') {
          setPhase('expired')
        } else {
          setPhase('error')
          /* 文案走唯一映射（阶段 2.4）：插件/网络的原始 message 不直接上屏 */
          setErrorText(describeError(err) ?? t('sources.qr.error'))
        }
        return
      } finally {
        inFlight = false
      }
      schedule()
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || stopped) return
      clearTimeout(timer)
      void tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    schedule()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phase, host, onAuthorized, t])

  const phaseText: string = {
    loading: t('sources.qr.loading'),
    waiting: qrHint || t('sources.qr.waiting'),
    scanned: t('sources.qr.scanned'),
    // 过期的原因（如「你在手机上拒绝了登录」）比一句笼统的「已过期」有用
    expired: (expiredReason && EXPIRED_REASONS[expiredReason] ? t(EXPIRED_REASONS[expiredReason]) : '') || t('sources.qr.expired'),
    error: errorText || t('sources.qr.error'),
  }[phase]

  return (
    <div className="flex flex-col items-center gap-4 pt-2">
      {/* 多链路扫码（QQ / 微信）：分段切换，切换即换码。
          凹槽里托起一片纸（.seg-option.is-on） */}
      {methods && methods.length > 1 && (
        <div
          role="tablist"
          aria-label={t('sources.qr.methodSwitch')}
          className="inline-flex gap-1 rounded-pill bg-paper-deep p-1"
        >
          {methods.map(method => {
            const active = method.id === activeMethod
            return (
              <button
                key={method.id}
                role="tab"
                aria-selected={active}
                onClick={() => switchMethod(method.id)}
                className={cn(
                  'seg-option h-9 min-w-[5.5em] px-4 text-[13.5px] font-medium transition-colors duration-150',
                  active ? 'is-on' : 'text-ink-soft hover:text-ink'
                )}
              >
                {methodLabel(method, t)}
              </button>
            )
          })}
        </div>
      )}
      <div className="relative">
        {/* 二维码放在纸片白底的圆角块里：图自带留白，块只负责托起 */}
        <div
          className={
            'h-[232px] w-[232px] rounded-md bg-sheet p-3 shadow-card transition-opacity ' +
            (phase === 'expired' ? 'opacity-25' : 'opacity-100')
          }
        >
          <img src={qrImage} alt={t('sources.qr.alt')} className="h-full w-full rounded-sm object-contain" />
        </div>
        {(phase === 'expired' || phase === 'error') && (
          <button
            onClick={() => void startQr(activeMethod)}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md text-[14px] font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowsClockwise size={24} className="text-primary" />
            {t('sources.qr.refresh')}
          </button>
        )}
      </div>
      {/* 状态只写在这一行文字里：读屏用户看不到二维码变灰，
          「已扫描，请在手机上确认」这类变化必须播报出来 */}
      <p
        role="status"
        aria-live="polite"
        className={
          'text-center text-[14px] leading-relaxed ' +
          (phase === 'scanned' ? 'text-primary' : phase === 'error' ? 'text-destructive' : 'text-ink-soft')
        }
      >
        {phaseText}
      </p>
    </div>
  )
}
