/**
 * Cookie 登录（PLAN 1.6）：放在登录步骤的「高级」折叠里。
 * 粘贴凭据串 → loginWithCookie 校验 → 回调凭据。
 */

import { useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import type { PluginHost } from '@/plugins/host/PluginHost'

export function CookieLogin({
  host,
  cookieHint,
  onAuthorized,
}: {
  host: PluginHost
  cookieHint?: string
  onAuthorized: (credentials: string) => void
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await host.call<{ credentials: string }>('n1ko.auth.loginWithCookie', trimmed)
      onAuthorized(result.credentials)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full border-t border-hair-soft pt-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-center gap-1.5 text-[12px] tracking-[0.14em] text-ink-faint hover:text-ink-soft transition-colors"
      >
        {t('sources.cookie.advanced')}
        <CaretDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-center text-[12px] text-ink-faint">{cookieHint || t('sources.cookie.hint')}</p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={t('sources.cookie.placeholder')}
            className="w-full rounded-md border border-hair bg-paper px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-ink-faint/70 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {error && (
            <p className="border-l-2 border-destructive pl-3 text-[12.5px] text-destructive">{error}</p>
          )}
          <div className="text-center">
            <Button onClick={submit} disabled={busy || !text.trim()}>
              {busy ? t('login.connecting') : t('sources.cookie.submit')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
