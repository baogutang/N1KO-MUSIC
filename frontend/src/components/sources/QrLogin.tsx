/**
 * 扫码登录（PLAN 1.6）：qrcode 库渲染 SVG，2 秒轮询，过期一键刷新。
 * 四种状态文字：等待扫描 / 已扫描，请在手机上确认 / 二维码已过期（刷新）/ 失败。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { useT } from '@/i18n'
import type { PluginHost } from '@/plugins/host/PluginHost'
import type { PluginQrCheckResult } from '@/plugins/types'
import { PluginCallError } from '@/plugins/host/PluginHost'

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
  const [qrSvg, setQrSvg] = useState('')
  const [errorText, setErrorText] = useState('')
  const qrKeyRef = useRef<string | null>(null)
  const cancelledRef = useRef(false)

  const startQr = useCallback(async () => {
    cancelledRef.current = false
    setPhase('loading')
    setErrorText('')
    try {
      const created = await host.call<{ key: string; content: string; expiresIn: number }>('n1ko.auth.createQr')
      if (cancelledRef.current) return
      qrKeyRef.current = created.key
      // 黑模块跟随界面墨色，扫码器照样认；背景留白保证对比度
      const svg = await QRCode.toString(created.content, {
        type: 'svg',
        margin: 1,
        width: 220,
        color: { dark: '#000000', light: '#ffffff' },
      })
      if (cancelledRef.current) return
      setQrSvg(svg)
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

  // 2 秒轮询；waiting / scanned 都继续，expired / confirmed / error 停
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'scanned') return
    const key = qrKeyRef.current
    if (!key) return
    const timer = setInterval(async () => {
      try {
        const result = await host.call<PluginQrCheckResult>('n1ko.auth.checkQr', key)
        if (cancelledRef.current) return
        if (result.status === 'waiting') return
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
        }
      } catch (err) {
        if (cancelledRef.current) return
        // checkQr 本身报错（key 被消费 / 网络）按过期处理，可刷新重试
        if (err instanceof PluginCallError && err.code === 'not-found') {
          setPhase('expired')
        } else {
          setPhase('error')
          setErrorText(err instanceof Error ? err.message : String(err))
        }
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
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
          // qrcode 库产出的 SVG（自渲染、无外链），按内容注入
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
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
      <p
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
