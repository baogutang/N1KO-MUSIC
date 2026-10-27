/**
 * 直连打卡设置。
 *
 * 只做 ListenBrainz 及兼容端点（Maloja、自建 ListenBrainz）。Last.fm 的写接口
 * 要用 app 级 secret 给每次请求签名，纯前端应用没有任何地方能安全放这个 secret，
 * 因此不提供假的「Last.fm 直连」——这一点在界面上直说。
 */

import { useEffect, useState } from 'react'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { Section, Row, Toggle, fieldInputClass, rowClass } from '@/components/settings/primitives'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { useScrobbleStore } from '@/store/scrobbleStore'
import { LISTENBRAINZ_DEFAULT_URL, validateToken } from '@/services/listenBrainz'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

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
    <Section title={t('section.scrobbling')}>
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
          className={cn(fieldInputClass, 'w-[260px] max-w-full')}
        />
      </Row>

      {token ? (
        <div className={cn(rowClass, 'justify-between')}>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[15px] font-medium">
              <CheckCircle size={16} weight="fill" className="text-sem-connected" />
              {userName ? t('scrobble.connectedAs', { name: userName }) : t('scrobble.connected')}
            </p>
            <p className="num mt-0.5 text-[13px] text-ink-faint">
              {lastSuccessAt
                ? t('scrobble.tokenNoteWithTime', {
                    tail: token.slice(-4),
                    time: new Date(lastSuccessAt).toLocaleString(),
                  })
                : t('scrobble.tokenNote', { tail: token.slice(-4) })}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            className="flex-shrink-0 text-destructive"
          >
            {t('scrobble.disconnect')}
          </Button>
        </div>
      ) : (
        <Row name={t('scrobble.userToken')} desc={t('scrobble.userTokenDesc')}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Input
              type="password"
              value={draftToken}
              onChange={e => setDraftToken(e.target.value)}
              placeholder={t('scrobble.tokenPlaceholder')}
              className={cn(fieldInputClass, 'w-[220px] max-w-full')}
            />
            <Button onClick={handleConnect} disabled={!draftToken.trim() || checking}>
              {checking ? t('scrobble.checking') : t('scrobble.connect')}
            </Button>
          </div>
        </Row>
      )}

      {(pending.length > 0 || lastError) && (
        <div className={cn(rowClass, 'flex-col items-start gap-1')}>
          {pending.length > 0 && (
            <p className="num text-[13px] text-ink-faint">
              {t('scrobble.pending', { count: pending.length })}
            </p>
          )}
          {lastError && (
            <p className="flex items-start gap-1.5 text-[13px] text-sem-error">
              <WarningCircle size={14} className="mt-px flex-shrink-0" />
              <span className="min-w-0 break-all">{t('scrobble.lastFailure', { message: lastError })}</span>
            </p>
          )}
        </div>
      )}
    </Section>
  )
}
