/**
 * 「从别处继续」——跨设备续播提示。
 *
 * 桌面听到一半出门，手机打开接着放。队列与位置存在音乐服务器本身
 * （Subsonic savePlayQueue，1.12.0 起就有），不需要自建后端。
 *
 * 做成吸顶工具栏下面一条安静的提示条而不是弹窗：它不该打断你，只是告诉你有这么回事。
 */

import { X } from '@phosphor-icons/react'
import { useRemoteQueueOffer } from '@/hooks/useQueueSync'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/utils/formatters'
import { useT } from '@/i18n'

export function ResumeOffer() {
  const { t } = useT()
  const { offer, accept, dismiss } = useRemoteQueueOffer()
  if (!offer) return null

  const current = offer.currentId
    ? offer.songs.find(s => s.id === offer.currentId)
    : offer.songs[0]
  if (!current) return null

  return (
    <div
      role="status"
      className="mx-3 regular:mx-5 mt-1 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-paper-deep px-4 py-2.5 text-[13.5px]"
    >
      <span className="min-w-[12rem] flex-1 text-ink-soft">
        {t('resume.prefix')}
        <span className="text-ink-faint">{offer.changedBy ? `${t('common.quoteL')}${offer.changedBy}${t('common.quoteR')}` : t('resume.otherDevice')}</span>
        {t('resume.suffix')}
        <span className="mx-1 font-display font-semibold text-ink">{current.title}</span>
        <span className="num text-ink-faint">{formatDuration(offer.positionMs / 1000)}</span>
      </span>
      <button
        onClick={accept}
        className="inline-flex min-h-9 items-center rounded-sm px-1 font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline motion-reduce:transition-none"
      >
        {t('resume.continue')}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={dismiss}
        aria-label={t('resume.dismiss')}
      >
        <X size={14} />
      </Button>
    </div>
  )
}
