/**
 * 「从别处继续」——跨设备续播提示。
 *
 * 桌面听到一半出门，手机打开接着放。队列与位置存在音乐服务器本身
 * （Subsonic savePlayQueue，1.12.0 起就有），不需要自建后端。
 *
 * 做成一行编辑式提示而不是弹窗：它不该打断你，只是告诉你有这么回事。
 */

import { X } from '@phosphor-icons/react'
import { useRemoteQueueOffer } from '@/hooks/useQueueSync'
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
      className="flex items-center justify-center gap-3 border-b border-hair bg-paper-deep px-4 py-2 text-[12.5px]"
    >
      <span className="text-ink-soft">
        {t('resume.prefix')}
        <span className="text-ink-faint">{offer.changedBy ? `「${offer.changedBy}」` : t('resume.otherDevice')}</span>
        {t('resume.suffix')}
        <span className="mx-1 font-serif font-semibold text-ink">{current.title}</span>
        <span className="font-num text-ink-faint">{formatDuration(offer.positionMs / 1000)}</span>
      </span>
      <button
        onClick={accept}
        className="border-b border-ink-soft pb-px text-ink transition-colors duration-200 hover:border-primary hover:text-primary"
      >
        {t('resume.continue')}
      </button>
      <button
        onClick={dismiss}
        className="grid h-6 w-6 place-items-center rounded-full text-ink-faint transition-colors duration-200 hover:text-ink"
        aria-label={t('resume.dismiss')}
      >
        <X size={12} />
      </button>
    </div>
  )
}
