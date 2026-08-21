/**
 * 直连打卡设置。
 *
 * 只做 ListenBrainz 及兼容端点（Maloja、自建 ListenBrainz）。Last.fm 的写接口
 * 要用 app 级 secret 给每次请求签名，纯前端应用没有任何地方能安全放这个 secret，
 * 因此不提供假的「Last.fm 直连」——这一点在界面上直说。
 */

import { useState } from 'react'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import { Section, Row, Toggle } from '@/components/settings/primitives'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { useScrobbleStore } from '@/store/scrobbleStore'
import { LISTENBRAINZ_DEFAULT_URL, validateToken } from '@/services/listenBrainz'

export function ScrobbleSettings() {
  const {
    enabled, apiUrl, token, userName, lastError, lastSuccessAt, pending,
    setConfig, reset,
  } = useScrobbleStore()
  const [draftToken, setDraftToken] = useState('')
  const [checking, setChecking] = useState(false)

  const handleConnect = async () => {
    const candidate = draftToken.trim()
    if (!candidate) return
    setChecking(true)
    try {
      const result = await validateToken(apiUrl, candidate)
      if (!result.valid) {
        toast({ title: result.message || 'token 没有通过校验', variant: 'destructive' })
        return
      }
      setConfig({ token: candidate, userName: result.userName, enabled: true })
      setDraftToken('')
      toast({ title: `已连接到 ${result.userName ?? 'ListenBrainz'}` })
    } finally {
      setChecking(false)
    }
  }

  return (
    <Section title="直连打卡" tag="SCROBBLING">
      <Row
        name="提交到 ListenBrainz"
        desc="与服务器自己的打卡并行，两边都记不冲突。只做 ListenBrainz 及兼容端点：Last.fm 的写接口要求用应用密钥签名，纯前端放不住这种密钥。"
      >
        <Toggle
          checked={enabled && !!token}
          onChange={next => {
            if (!token) {
              toast({ title: '先填 token 并连接' })
              return
            }
            setConfig({ enabled: next })
          }}
          label="提交到 ListenBrainz"
        />
      </Row>

      <Row name="端点地址" desc="改成自建 ListenBrainz 或 Maloja 的地址也可以">
        <Input
          value={apiUrl}
          onChange={e => setConfig({ apiUrl: e.target.value })}
          placeholder={LISTENBRAINZ_DEFAULT_URL}
          className="w-[260px]"
        />
      </Row>

      {token ? (
        <div className="flex items-center justify-between gap-6 border-b border-hair-soft py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CheckCircle size={14} weight="fill" className="text-primary" />
              已连接{userName ? ` · ${userName}` : ''}
            </p>
            <p className="font-num mt-0.5 text-xs text-ink-faint">
              token 尾号 {token.slice(-4)} · 只存在本机，只发往上面这个地址
              {lastSuccessAt ? ` · 最近成功 ${new Date(lastSuccessAt).toLocaleString()}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="flex-shrink-0 text-sm text-destructive underline decoration-1 underline-offset-[6px] decoration-destructive/40 transition-colors hover:decoration-destructive"
          >
            断开
          </button>
        </div>
      ) : (
        <Row name="用户 token" desc="在 ListenBrainz 的 Settings 页面获取">
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={draftToken}
              onChange={e => setDraftToken(e.target.value)}
              placeholder="粘贴 token"
              className="w-[220px]"
            />
            <Button onClick={handleConnect} disabled={!draftToken.trim() || checking}>
              {checking ? '校验中…' : '连接'}
            </Button>
          </div>
        </Row>
      )}

      {(pending.length > 0 || lastError) && (
        <div className="py-4">
          {pending.length > 0 && (
            <p className="font-num text-xs text-ink-faint">
              有 {pending.length} 条等待补交，联网后自动重试
            </p>
          )}
          {lastError && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
              <WarningCircle size={13} className="mt-px flex-shrink-0" />
              <span className="min-w-0 break-all">最近一次失败：{lastError}</span>
            </p>
          )}
        </div>
      )}
    </Section>
  )
}
