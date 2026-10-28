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
import { describeError } from '@/services/errors'
import { Copy, Check, Trash, LinkSimple } from '@phosphor-icons/react'
import { findAdapterFor } from '@/api'
import { toast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

interface ShareTarget {
  ids: string[]
  /** 展示用的名字 */
  label: string
  kind: 'song' | 'album' | 'playlist'
  /**
   * 条目所属音源；缺省回落主库（旧的单源调用方）。
   *
   * 分享链接由**存着这首歌的那台服务器**托管，id 也只在它那儿有意义。
   * 写死主库时，分享一首网易云的歌等于拿它的 id 去 NAS 上建分享：
   * 要么报错，要么建出一条指向别的曲子的链接——后者更糟，因为它看起来成功了。
   */
  serverId?: string
}

const KIND_TITLE_KEYS: Record<ShareTarget['kind'], string> = {
  song: 'share.title.song',
  album: 'share.title.album',
  playlist: 'share.title.playlist',
}

/**
 * 服务器把分享整个关掉时回的是 501。这种情况不是「出错了再试一次」，
 * 而是「这台服务器不提供这个功能」——照抄 axios 的 "Request failed with
 * status code 501" 给用户看，等于什么都没说。能力探测已经会提前把入口藏掉，
 * 这里是最后一道：万一探测时是开着的、创建时被关了，也要说清楚发生了什么。
 */
function isSharingDisabled(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (status === 501) return true
  // 兜底只认 axios 那句固定措辞。裸的 /501/ 会误伤任何碰巧含这三个数字的
  // 服务器错误文本（比如歌名或路径里带 501），把无关的失败说成「没开分享」。
  return err instanceof Error && /status code 501\b/.test(err.message)
}

interface ShareRecord {
  id: string
  url: string
  description?: string
  expiresAt?: number
  visitCount?: number
}

/** 行内图标键：36px 圆形，触屏拉到 44px；hover 铺一层墨色淡底 */
const ICON_BTN =
  'press-pop grid h-9 w-9 flex-none place-items-center rounded-pill text-ink-3 hover:bg-ink/[0.08] hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11'

const EXPIRY_OPTIONS = [
  { days: 1, labelKey: 'share.expiry1Day' },
  { days: 7, labelKey: 'share.expiry7Days' },
  { days: 30, labelKey: 'share.expiry30Days' },
  { days: 0, labelKey: 'share.expiryNever' },
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
  const { t, locale } = useT()
  const [description, setDescription] = useState('')
  const [expiryDays, setExpiryDays] = useState(7)
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<ShareRecord | null>(null)
  const [copied, setCopied] = useState(false)
  const [existing, setExisting] = useState<ShareRecord[]>([])

  /** 分享全程只跟一个适配器打交道：目标条目自己那个源 */
  const targetServerId = target?.serverId
  const loadExisting = useCallback(async () => {
    const adapter = findAdapterFor(targetServerId)
    if (!adapter) return
    const list = await adapter.getShares?.().catch(() => [])
    setExisting(list ?? [])
  }, [targetServerId])

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
    const adapter = findAdapterFor(target?.serverId)
    if (!target || creating || !adapter) return
    setCreating(true)
    try {
      const share = await adapter.createShare?.(target.ids, {
        description: description.trim() || undefined,
        expiresAt: expiryDays > 0 ? Date.now() + expiryDays * 86_400_000 : undefined,
      })
      if (!share?.url) throw new Error(t('share.noUrl'))
      setCreated(share)
      void loadExisting()
    } catch (err) {
      const disabled = isSharingDisabled(err)
      toast({
        title: disabled ? t('share.serverDisabled') : t('share.createFailed'),
        description: disabled
          ? t('share.serverDisabledHint')
          : describeError(err),
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
      toast({ title: t('share.copyFailed'), variant: 'destructive' })
    }
  }

  async function revoke(id: string) {
    try {
      // 撤销要打建它的那台服务器，否则「撤销成功」而链接照样能开
      await findAdapterFor(targetServerId)?.deleteShare?.(id)
      setExisting(list => list.filter(s => s.id !== id))
      if (created?.id === id) setCreated(null)
    } catch {
      toast({ title: t('share.revokeFailed'), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{target ? t(KIND_TITLE_KEYS[target.kind]) : t('share.title')}</DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                {t('share.description')}
                <span className="mt-1 block truncate font-medium text-ink">
                  {t('share.targetLabel', { label: target.label })}
                </span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2 rounded-md bg-fill py-1.5 pl-3.5 pr-1.5">
              <LinkSimple size={16} className="flex-none text-ink-3" aria-hidden="true" />
              <span className="num min-w-0 flex-1 truncate text-[14px] text-ink">{created.url}</span>
              <button
                onClick={() => copy(created.url)}
                className={ICON_BTN}
                aria-label={t('share.copyLink')}
              >
                {copied ? <Check size={16} weight="bold" className="text-leaf" /> : <Copy size={16} />}
              </button>
            </div>
            <p className="text-[13px] text-ink-3">
              {created.expiresAt
                ? t('share.expiresOn', {
                    date: new Date(created.expiresAt).toLocaleDateString(locale),
                  })
                : t('share.neverExpires')}
            </p>
          </div>
        ) : (
          <div className="space-y-5 pt-1">
            <div>
              <label htmlFor="share-desc" className="mb-2 block text-[15px] font-medium text-ink">
                {t('share.note')}
              </label>
              <Input
                id="share-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('share.notePlaceholder')}
                maxLength={120}
              />
            </div>
            <div>
              <p className="mb-2 text-[15px] font-medium text-ink">{t('share.expiry')}</p>
              <div role="radiogroup" aria-label={t('share.expiry')} className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map(opt => (
                  <button
                    key={opt.days}
                    type="button"
                    role="radio"
                    aria-checked={expiryDays === opt.days}
                    onClick={() => setExpiryDays(opt.days)}
                    className={cn(
                      'press-pop min-h-11 rounded-pill px-4 text-[14px] font-semibold',
                      expiryDays === opt.days
                        ? 'bg-ink text-ground'
                        : 'bg-fill text-ink-2 hover:bg-fill-2 hover:text-ink'
                    )}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3">
          {/* 创建前：取消是次要键，创建是这个对话框唯一的青柠键；创建后只剩「完成」，它就是主键 */}
          <Button variant={created ? 'default' : 'secondary'} onClick={() => onOpenChange(false)}>
            {created ? t('action.done') : t('action.cancel')}
          </Button>
          {!created && (
            <Button onClick={handleCreate} disabled={creating || !target}>
              {creating ? t('action.creating') : t('share.create')}
            </Button>
          )}
        </div>

        {existing.length > 0 && (
          <div className="mt-2">
            <p className="mb-1.5 flex items-baseline gap-3 text-[13px] font-semibold text-ink-3">
              <span>{t('share.existingTitle')}</span>
              <span className="num font-normal">{existing.length}</span>
            </p>
            <ul className="-mx-2 max-h-44 overflow-y-auto">
              {existing.map(share => (
                <li
                  key={share.id}
                  className="flex items-center gap-1 rounded-[12px] py-0.5 pl-3 text-[14px] hover:bg-ink/[0.05]"
                >
                  <span className="min-w-0 flex-1 truncate text-ink-2">
                    {share.description || share.url}
                  </span>
                  {share.visitCount != null && (
                    <span className="num flex-none text-[13px] text-ink-3">
                      {t('share.visits', { count: share.visitCount })}
                    </span>
                  )}
                  <button
                    onClick={() => copy(share.url)}
                    className={ICON_BTN}
                    aria-label={t('share.copyOne')}
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => revoke(share.id)}
                    className={cn(ICON_BTN, 'hover:text-danger')}
                    aria-label={t('share.revokeOne')}
                  >
                    <Trash size={16} />
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
