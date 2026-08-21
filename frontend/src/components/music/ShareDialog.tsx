/**
 * 公开分享链接。
 *
 * 把一首歌、一张专辑或一个歌单变成一个朋友无需账号即可打开的页面。
 * 链接由音乐服务器自己托管（Subsonic createShare），本项目不经手任何内容。
 *
 * 这是一个「往外发布」的动作，因此：过期时间必须显式选择、
 * 创建后立刻把链接摆出来、并给一个可撤销的管理列表。
 */

import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Trash, LinkSimple } from '@phosphor-icons/react'
import { getAdapter, hasAdapter } from '@/api'
import { toast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ShareTarget {
  ids: string[]
  /** 展示用的名字 */
  label: string
  kind: '歌曲' | '专辑' | '歌单'
}

interface ShareRecord {
  id: string
  url: string
  description?: string
  expiresAt?: number
  visitCount?: number
}

const EXPIRY_OPTIONS = [
  { days: 1, label: '1 天' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 0, label: '不过期' },
]

export function ShareDialog({
  target,
  open,
  onOpenChange,
}: {
  target: ShareTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [description, setDescription] = useState('')
  const [expiryDays, setExpiryDays] = useState(7)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<ShareRecord | null>(null)
  const [copied, setCopied] = useState(false)
  const [existing, setExisting] = useState<ShareRecord[]>([])

  const loadExisting = useCallback(async () => {
    if (!hasAdapter()) return
    const list = await getAdapter().getShares?.().catch(() => [])
    setExisting(list ?? [])
  }, [])

  useEffect(() => {
    if (!open) {
      setDescription('')
      setCreated(null)
      setCopied(false)
      setCreating(false)
      return
    }
    void loadExisting()
  }, [open, loadExisting])

  async function handleCreate() {
    if (!target || creating || !hasAdapter()) return
    setCreating(true)
    try {
      const share = await getAdapter().createShare?.(target.ids, {
        description: description.trim() || undefined,
        expiresAt: expiryDays > 0 ? Date.now() + expiryDays * 86_400_000 : undefined,
      })
      if (!share?.url) throw new Error('服务器没有返回链接')
      setCreated(share)
      void loadExisting()
    } catch (err) {
      toast({
        title: '创建分享链接失败',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast({ title: '复制失败，请手动选择链接', variant: 'destructive' })
    }
  }

  async function revoke(id: string) {
    try {
      await getAdapter().deleteShare?.(id)
      setExisting(list => list.filter(s => s.id !== id))
      if (created?.id === id) setCreated(null)
    } catch {
      toast({ title: '撤销失败', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>分享{target?.kind ?? ''}</DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                生成一个公开链接，对方无需账号即可打开
                <span className="mt-1 block font-serif text-foreground">「{target.label}」</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4 pt-1">
            <div className="flex items-center gap-2 rounded border border-hair bg-paper-deep px-3 py-2.5">
              <LinkSimple size={14} className="flex-none text-ink-faint" aria-hidden="true" />
              <span className="font-num min-w-0 flex-1 truncate text-[12.5px]">{created.url}</span>
              <button
                onClick={() => copy(created.url)}
                className="flex-none text-ink-soft transition-colors hover:text-primary"
                aria-label="复制链接"
              >
                {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
              </button>
            </div>
            <p className="text-[12px] text-ink-faint">
              {created.expiresAt
                ? `将于 ${new Date(created.expiresAt).toLocaleDateString('zh-CN')} 失效`
                : '不会自动失效，可随时在下方撤销'}
            </p>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div>
              <label htmlFor="share-desc" className="mb-1.5 block text-[11px] tracking-[0.16em] text-ink-faint">
                说明（可选）
              </label>
              <Input
                id="share-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="给对方的一句话"
                maxLength={120}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[11px] tracking-[0.16em] text-ink-faint">有效期</p>
              <div role="radiogroup" aria-label="有效期" className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map(opt => (
                  <button
                    key={opt.days}
                    type="button"
                    role="radio"
                    aria-checked={expiryDays === opt.days}
                    onClick={() => setExpiryDays(opt.days)}
                    className={cn(
                      'border px-3 py-1.5 text-[12.5px] transition-colors duration-200',
                      expiryDays === opt.days
                        ? 'border-primary text-primary'
                        : 'border-hair text-ink-soft hover:border-ink hover:text-ink'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {created ? '完成' : '取消'}
          </Button>
          {!created && (
            <Button onClick={handleCreate} disabled={creating || !target}>
              {creating ? '创建中' : '生成链接'}
            </Button>
          )}
        </div>

        {existing.length > 0 && (
          <div className="mt-2 border-t border-hair pt-3">
            <p className="mb-2 text-[10.5px] uppercase tracking-[0.22em] text-ink-faint">
              已有的分享 · {existing.length}
            </p>
            <ul className="max-h-40 space-y-0 overflow-y-auto">
              {existing.map(share => (
                <li
                  key={share.id}
                  className="flex items-center gap-2 border-b border-hair-soft py-2 text-[12px]"
                >
                  <span className="min-w-0 flex-1 truncate text-ink-soft">
                    {share.description || share.url}
                  </span>
                  {share.visitCount != null && (
                    <span className="font-num flex-none text-[11px] text-ink-faint">
                      {share.visitCount} 次访问
                    </span>
                  )}
                  <button
                    onClick={() => copy(share.url)}
                    className="flex-none text-ink-faint transition-colors hover:text-primary"
                    aria-label="复制这条分享链接"
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    onClick={() => revoke(share.id)}
                    className="flex-none text-ink-faint transition-colors hover:text-destructive"
                    aria-label="撤销这条分享链接"
                  >
                    <Trash size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
