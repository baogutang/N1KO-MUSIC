/**
 * 同步服务设置分区。
 *
 * 同步指向自建的 N1KO 后端（backend/），与音乐服务器是两回事：
 * 音乐始终直连音乐服务器，这里只把收听历史镜像出去，用于跨设备复原推荐画像。
 * 不填地址、不登录时，应用行为与从前完全一致。
 */

import { useState } from 'react'
import { ArrowsClockwise, CloudCheck, CloudSlash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/use-toast'
import { Row, Section, SubHead, Toggle, hairInputClass } from '@/components/settings/primitives'
import { useSyncStore, syncStatus } from '@/store/syncStore'
import { enqueueLocalBacklog, pullRemoteHistory } from '@/services/historySync'
import { t as translate, useT } from '@/i18n'
import { cn } from '@/lib/utils'

const STATUS_KEY: Record<ReturnType<typeof syncStatus>, string> = {
  disabled: 'sync.status.disabled',
  unconfigured: 'sync.status.unconfigured',
  'signed-out': 'sync.status.signedOut',
  connected: 'sync.status.connected',
  error: 'sync.status.error',
}

function formatSyncedAt(timestamp: number | null): string {
  if (!timestamp) return translate('sync.neverSynced')
  const date = new Date(timestamp)
  return translate('sync.syncedAt', {
    month: date.getMonth() + 1,
    day: date.getDate(),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  })
}

export function SyncSettings() {
  const { t } = useT()
  const {
    enabled, baseUrl, token, username, lastError, lastSyncedAt, busy,
    setEnabled, setBaseUrl, testConnection, signIn, signUp, signOut,
  } = useSyncStore()

  const [draftUrl, setDraftUrl] = useState(baseUrl)
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [pulling, setPulling] = useState(false)

  const status = syncStatus({ enabled, baseUrl, token })
  const signedIn = !!token

  const handleUrlCommit = () => {
    if (draftUrl.trim() === baseUrl) return
    setBaseUrl(draftUrl)
  }

  const handleTest = async () => {
    setBaseUrl(draftUrl)
    const ok = await testConnection()
    toast(ok
      ? { title: t('sync.testOk') }
      : { title: t('sync.testFailed'), description: t('sync.testFailedDesc'), variant: 'destructive' })
  }

  const handleAuth = async (mode: 'in' | 'up') => {
    setBaseUrl(draftUrl)
    const ok = mode === 'in'
      ? await signIn(account, password)
      : await signUp(account, password)
    if (!ok) return
    setPassword('')
    // 登录成功后双向对齐一次：先把本机历史补推上去，再把其他设备的记录拉回来
    const queued = enqueueLocalBacklog()
    const imported = await pullRemoteHistory()
    toast({
      title: mode === 'in' ? t('sync.signedIn') : t('sync.accountCreated'),
      description: t('sync.authSummary', { queued, imported }),
    })
  }

  const handlePull = async () => {
    setPulling(true)
    const imported = await pullRemoteHistory()
    setPulling(false)
    toast({
      title: t('sync.pullDone'),
      description: imported > 0
        ? t('sync.pullMerged', { count: imported })
        : t('sync.pullNothing'),
    })
  }

  return (
    <Section title={t('sync.title')} tag="SYNC">
      <Row
        name={t('sync.enable')}
        desc={t('sync.enableDesc')}
      >
        <Toggle checked={enabled} onChange={setEnabled} label={t('sync.toggleLabel')} />
      </Row>

      {enabled && (
        <>
          <Row
            name={t('sync.connection')}
            desc={signedIn
              ? t('sync.accountLine', { name: username ?? '', time: formatSyncedAt(lastSyncedAt) })
              : undefined}
          >
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm',
                status === 'connected' ? 'text-primary' : 'text-ink-faint'
              )}
            >
              {status === 'connected'
                ? <CloudCheck className="h-4 w-4" />
                : <CloudSlash className="h-4 w-4" />}
              {t(STATUS_KEY[status])}
            </span>
          </Row>

          <div className="border-b border-hair-soft py-4">
            <div className="flex items-center gap-4">
              <p className="w-20 flex-shrink-0 text-sm font-medium">{t('sync.serverUrl')}</p>
              <Input
                type="url"
                value={draftUrl}
                onChange={e => setDraftUrl(e.target.value)}
                onBlur={handleUrlCommit}
                placeholder="http://192.168.1.10:3001"
                className={hairInputClass}
              />
              <Button variant="ghost" onClick={handleTest} disabled={busy} className="flex-shrink-0 gap-1.5 px-0">
                {busy ? <ArrowsClockwise className="h-4 w-4 animate-spin" /> : null}
                {t('sync.test')}
              </Button>
            </div>
            <p className="mt-2 pl-24 text-xs text-ink-faint">
              {t('sync.serverUrlHint')}
            </p>
          </div>

          {signedIn ? (
            <>
              <Row name={t('sync.manual')} desc={t('sync.manualDesc')}>
                <Button variant="ghost" onClick={handlePull} disabled={pulling} className="gap-1.5 px-0">
                  {pulling ? <ArrowsClockwise className="h-4 w-4 animate-spin" /> : null}
                  {pulling ? t('sync.syncing') : t('sync.syncNow')}
                </Button>
              </Row>
              <Row name={t('sync.signOut')} desc={t('sync.signOutDesc')}>
                <Button
                  variant="ghost"
                  onClick={() => { signOut(); toast({ title: t('sync.signedOut') }) }}
                  className="gap-1.5 px-0 text-destructive hover:text-destructive"
                >
                  {t('sync.signOutAction')}
                </Button>
              </Row>
            </>
          ) : (
            <>
              <SubHead title={t('sync.signInHead')} />
              <div className="border-b border-hair-soft py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[11px] tracking-[0.2em] text-ink-faint">{t('login.username')}</label>
                    <Input
                      type="text"
                      value={account}
                      autoComplete="username"
                      onChange={e => setAccount(e.target.value)}
                      className={hairInputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] tracking-[0.2em] text-ink-faint">{t('login.password')}</label>
                    <Input
                      type="password"
                      value={password}
                      autoComplete="current-password"
                      onChange={e => setPassword(e.target.value)}
                      className={hairInputClass}
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-5">
                  <Button
                    onClick={() => void handleAuth('in')}
                    disabled={busy || !account.trim() || !password}
                    className="gap-1.5 px-0"
                  >
                    {busy ? <ArrowsClockwise className="h-4 w-4 animate-spin" /> : null}
                    {t('login.signIn')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void handleAuth('up')}
                    disabled={busy || !account.trim() || password.length < 8}
                    className="gap-1.5 px-0"
                  >
                    {t('login.signUp')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-ink-faint">{t('sync.passwordHint')}</p>
              </div>
            </>
          )}

          {lastError && <p className="pt-3 text-xs text-destructive">{lastError}</p>}
        </>
      )}
    </Section>
  )
}
