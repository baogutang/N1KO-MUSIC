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
import { cn } from '@/lib/utils'

const STATUS_TEXT: Record<ReturnType<typeof syncStatus>, string> = {
  disabled: '已关闭',
  unconfigured: '未填写服务地址',
  'signed-out': '未登录',
  connected: '已连接',
  error: '异常',
}

function formatSyncedAt(timestamp: number | null): string {
  if (!timestamp) return '尚未同步'
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function SyncSettings() {
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
      ? { title: '同步服务可用' }
      : { title: '连接失败', description: '请确认地址可访问且已启动后端', variant: 'destructive' })
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
      title: mode === 'in' ? '已登录同步服务' : '同步账号已创建',
      description: `本机 ${queued} 条待上传，已从云端合并 ${imported} 条`,
    })
  }

  const handlePull = async () => {
    setPulling(true)
    const imported = await pullRemoteHistory()
    setPulling(false)
    toast({
      title: '同步完成',
      description: imported > 0 ? `合并了 ${imported} 条云端记录` : '云端没有更新的记录',
    })
  }

  return (
    <Section title="跨设备同步" tag="SYNC">
      <Row
        name="启用同步"
        desc="把收听历史镜像到自建的 N1KO 后端，换设备后推荐画像不用从零开始"
      >
        <Toggle checked={enabled} onChange={setEnabled} label="启用跨设备同步" />
      </Row>

      {enabled && (
        <>
          <Row
            name="连接状态"
            desc={signedIn ? `账号 ${username ?? ''} · 上次同步 ${formatSyncedAt(lastSyncedAt)}` : undefined}
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
              {STATUS_TEXT[status]}
            </span>
          </Row>

          <div className="border-b border-hair-soft py-4">
            <div className="flex items-center gap-4">
              <p className="w-20 flex-shrink-0 text-sm font-medium">服务地址</p>
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
                测试
              </Button>
            </div>
            <p className="mt-2 pl-24 text-xs text-ink-faint">
              自建后端的地址，需自行部署 backend/ 后填写；留空则不同步。
            </p>
          </div>

          {signedIn ? (
            <>
              <Row name="手动同步" desc="立即从云端拉取其他设备写入的记录">
                <Button variant="ghost" onClick={handlePull} disabled={pulling} className="gap-1.5 px-0">
                  {pulling ? <ArrowsClockwise className="h-4 w-4 animate-spin" /> : null}
                  {pulling ? '同步中…' : '立即同步'}
                </Button>
              </Row>
              <Row name="退出同步账号" desc="本地历史不会被删除，只是停止上传与下载">
                <Button
                  variant="ghost"
                  onClick={() => { signOut(); toast({ title: '已退出同步账号' }) }}
                  className="gap-1.5 px-0 text-destructive hover:text-destructive"
                >
                  退出
                </Button>
              </Row>
            </>
          ) : (
            <>
              <SubHead title="登录同步账号" />
              <div className="border-b border-hair-soft py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1.5 block text-[11px] tracking-[0.2em] text-ink-faint">用户名</label>
                    <Input
                      type="text"
                      value={account}
                      autoComplete="username"
                      onChange={e => setAccount(e.target.value)}
                      className={hairInputClass}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11px] tracking-[0.2em] text-ink-faint">密码</label>
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
                    登录
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void handleAuth('up')}
                    disabled={busy || !account.trim() || password.length < 8}
                    className="gap-1.5 px-0"
                  >
                    注册新账号
                  </Button>
                </div>
                <p className="mt-2 text-xs text-ink-faint">注册密码至少 8 位。</p>
              </div>
            </>
          )}

          {lastError && <p className="pt-3 text-xs text-destructive">{lastError}</p>}
        </>
      )}
    </Section>
  )
}
