/**
 * 扫码登录（PLAN 1.6）：qrcode 库渲染 SVG，2 秒轮询，过期一键刷新。
 * 四种状态文字：等待扫描 / 已扫描，请在手机上确认 / 二维码已过期（刷新）/ 失败。
 *
 * 轮询是 setTimeout 链而不是 setInterval，理由见下面 pollLoop 的注释：
 * 后台标签页要停、慢请求不能叠、二维码自己的有效期要算数。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { useT } from '@/i18n'
import type { PluginHost } from '@/plugins/host/PluginHost'
import type { PluginQrCheckResult } from '@/plugins/types'
import { PluginCallError } from '@/plugins/host/PluginHost'
import { safeResourceUrl } from '@/plugins/host/whitelist'

const POLL_INTERVAL_MS = 2000

type QrPhase = 'loading' | 'waiting' | 'scanned' | 'expired' | 'error'

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
  const [phase, setPhase] = useState<QrPhase>('loading')
  /** 二维码统一以 <img> 渲染（服务端图或本地生成的 data URL） */
  const [qrImage, setQrImage] = useState('')
  const [errorText, setErrorText] = useState('')
  const qrKeyRef = useRef<string | null>(null)
  const cancelledRef = useRef(false)
  /** 这张码本地算出来的到期时刻（毫秒时间戳）；插件没给 expiresIn 时为 null */
  const expiresAtRef = useRef<number | null>(null)

  const startQr = useCallback(async () => {
    cancelledRef.current = false
    setPhase('loading')
    setErrorText('')
    setQrImage('')
    expiresAtRef.current = null
    try {
      const created = await host.call<{ key: string; content: string; expiresIn: number; qrImage?: string }>('n1ko.auth.createQr')
      if (cancelledRef.current) return
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
        setQrImage(safeQrImage)
      } else {
        // 统一走 data URL <img>：SVG 注入会带固有宽高，URL 变长时溢出方框
        const dataUrl = await QRCode.toDataURL(created.content, {
          margin: 1,
          width: 440,
          color: { dark: '#000000', light: '#ffffff' },
        })
        if (cancelledRef.current) return
        setQrImage(dataUrl)
      }
      setPhase('waiting')
    } catch (err) {
      if (cancelledRef.current) return
      setPhase('error')
      setErrorText(err instanceof Error ? err.message : String(err))
    }
  }, [host])

  useEffect(() => {
    void startQr()
    return () => {
      cancelledRef.current = true
    }
  }, [startQr])

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
          setErrorText(err instanceof Error ? err.message : String(err))
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
  }, [phase, host, onAuthorized])

  const phaseText: string = {
    loading: t('sources.qr.loading'),
    waiting: qrHint || t('sources.qr.waiting'),
    scanned: t('sources.qr.scanned'),
    expired: t('sources.qr.expired'),
    error: errorText || t('sources.qr.error'),
  }[phase]

  return (
    <div className="flex flex-col items-center gap-4 pt-2">
      <div className="relative">
        <div
          className={
            'w-[220px] h-[220px] rounded-md ring-1 ring-hair bg-white p-2 transition-opacity ' +
            (phase === 'expired' ? 'opacity-25' : 'opacity-100')
          }
        >
          <img src={qrImage} alt={t('sources.qr.alt')} className="w-full h-full object-contain" />
        </div>
        {phase === 'expired' && (
          <button
            onClick={() => void startQr()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[13px] font-medium text-foreground"
          >
            <ArrowsClockwise size={22} className="text-primary" />
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
          'text-center text-[13px] leading-relaxed ' +
          (phase === 'scanned' ? 'text-primary' : phase === 'error' ? 'text-destructive' : 'text-ink-soft')
        }
      >
        {phaseText}
      </p>
    </div>
  )
}
