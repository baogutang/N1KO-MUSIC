/**
 * 直连打卡设置。
 *
 * 只做 ListenBrainz 及兼容端点（Maloja、自建 ListenBrainz）。Last.fm 的写接口
 * 要用 app 级 secret 给每次请求签名，纯前端应用没有任何地方能安全放这个 secret，
 * 因此不提供假的「Last.fm 直连」——这一点在界面上直说。
 */

import { useEffect, useState } from 'react'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { Section, Row, Toggle } from '@/components/settings/primitives'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { useScrobbleStore } from '@/store/scrobbleStore'
import { LISTENBRAINZ_DEFAULT_URL, validateToken } from '@/services/listenBrainz'
import { useT } from '@/i18n'

export function ScrobbleSettings() {
  const { t } = useT()
  const {
    enabled, apiUrl, token, userName, lastError, lastSuccessAt, pending,
    setConfig, reset,
  } = useScrobbleStore()
  const [draftToken, setDraftToken] = useState('')
  const [checking, setChecking] = useState(false)
  const [draftUrl, setDraftUrl] = useState(apiUrl)

  // 别处改了端点（比如断开重置）时，草稿跟上
  useEffect(() => { setDraftUrl(apiUrl) }, [apiUrl])

  const commitEndpoint = () => {
    const next = draftUrl.trim()
    if (!next || next === apiUrl) {
      setDraftUrl(apiUrl)
      return
    }
    if (token) {
      // 换主机等于换服务：断开并要求重新校验，绝不把旧 token 带到新地址
      reset()
      setConfig({ apiUrl: next })
      toast({ title: t('scrobble.endpointChanged'), description: t('scrobble.endpointChangedDesc') })
      return
    }
    setConfig({ apiUrl: next })
  }

  const handleConnect = async () => {
    const candidate = draftToken.trim()
    if (!candidate) return
    setChecking(true)
    try {
      const result = await validateToken(apiUrl, candidate)
      if (!result.valid) {
        toast({ title: result.message || t('scrobble.tokenRejected'), variant: 'destructive' })
        return
      }
      setConfig({ token: candidate, userName: result.userName, enabled: true })
      setDraftToken('')
      toast({ title: t('scrobble.connectedTo', { name: result.userName ?? 'ListenBrainz' }) })
    } finally {
      setChecking(false)
    }
  }

  return (
    <Section title={t('section.scrobbling')} tag="SCROBBLING">
      <Row
        name={t('scrobble.submit')}
        desc={t('scrobble.submitDesc')}
      >
        <Toggle
          checked={enabled && !!token}
          onChange={next => {
            if (!token) {
              toast({ title: t('scrobble.needToken') })
              return
            }
            setConfig({ enabled: next })
          }}
          label={t('scrobble.submit')}
        />
      </Row>

      {/*
        端点地址是**草稿**，失焦或回车才提交。
        以前是每敲一个键就写进 store，而 useDirectScrobble 依赖 apiUrl，
        于是打 "https://lb.example" 的过程中，token 会被依次发往
        https://l、https://lb、https://lb.e……每一个能解析的前缀主机。
        提交时如果已经连着一个 token，一并断开：token 是发给某一台主机的，
        换了主机就必须重新校验，不能顺手带过去。
      */}
      <Row name={t('scrobble.endpoint')} desc={t('scrobble.endpointDesc')}>
        <Input
          value={draftUrl}
          onChange={e => setDraftUrl(e.target.value)}
          onBlur={commitEndpoint}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder={LISTENBRAINZ_DEFAULT_URL}
          className="w-[260px]"
        />
      </Row>

      {token ? (
        <div className="flex items-center justify-between gap-6 border-b border-hair-soft py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CheckCircle size={14} weight="fill" className="text-primary" />
              {userName ? t('scrobble.connectedAs', { name: userName }) : t('scrobble.connected')}
            </p>
            <p className="font-num mt-0.5 text-xs text-ink-faint">
              {lastSuccessAt
                ? t('scrobble.tokenNoteWithTime', {
                    tail: token.slice(-4),
                    time: new Date(lastSuccessAt).toLocaleString(),
                  })
                : t('scrobble.tokenNote', { tail: token.slice(-4) })}
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex-shrink-0 text-sm text-destructive underline decoration-1 underline-offset-[6px] decoration-destructive/40 transition-colors hover:decoration-destructive"
          >
            {t('scrobble.disconnect')}
          </button>
        </div>
      ) : (
        <Row name={t('scrobble.userToken')} desc={t('scrobble.userTokenDesc')}>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={draftToken}
              onChange={e => setDraftToken(e.target.value)}
              placeholder={t('scrobble.tokenPlaceholder')}
              className="w-[220px]"
            />
            <Button onClick={handleConnect} disabled={!draftToken.trim() || checking}>
              {checking ? t('scrobble.checking') : t('scrobble.connect')}
            </Button>
          </div>
        </Row>
      )}

      {(pending.length > 0 || lastError) && (
        <div className="py-4">
          {pending.length > 0 && (
            <p className="font-num text-xs text-ink-faint">
              {t('scrobble.pending', { count: pending.length })}
            </p>
          )}
          {lastError && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
              <WarningCircle size={13} className="mt-px flex-shrink-0" />
              <span className="min-w-0 break-all">{t('scrobble.lastFailure', { message: lastError })}</span>
            </p>
          )}
        </div>
      )}
    </Section>
  )
}
