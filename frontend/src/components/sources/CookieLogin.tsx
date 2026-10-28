/**
 * Cookie 登录（PLAN 1.6）：放在登录步骤的「高级」折叠里。
 * 粘贴凭据串 → loginWithCookie 校验 → 回调凭据。
 */

import { useState } from 'react'
import { describeError } from '@/services/errors'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
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
      setError(describeError(err) ?? t('error.unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="press-pop mx-auto flex min-h-11 items-center justify-center gap-1.5 rounded-pill px-4 text-[14px] font-semibold text-ink-3 hover:bg-ink/[0.05] hover:text-ink-2"
      >
        {t('sources.cookie.toggle')}
        {open ? <CaretUp size={13} weight="bold" /> : <CaretDown size={13} weight="bold" />}
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg bg-surface-2 p-4">
          <p className="text-[13px] leading-relaxed text-ink-3">{cookieHint || t('sources.cookie.hint')}</p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={t('sources.cookie.placeholder')}
            className="w-full rounded-sm border border-edge/60 bg-surface px-3.5 py-2.5 text-[16px] text-ink placeholder:text-ink-3 hover:border-edge regular:text-[14px]"
          />
          {error && (
            <p className="rounded-sm bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>
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
