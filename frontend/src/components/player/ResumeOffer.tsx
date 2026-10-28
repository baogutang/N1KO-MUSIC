/**
 * 「从别处继续」——跨设备续播提示。
 *
 * 桌面听到一半出门，手机打开接着放。队列与位置存在音乐服务器本身
 * （Subsonic savePlayQueue，1.12.0 起就有），不需要自建后端。
 *
 * 做成吸顶工具栏下面一枚安静的玻璃胶囊而不是弹窗：它不该打断你，只是告诉你有这么回事。
 * 「继续播放」本身就是一个播放动作，所以是这条胶囊里唯一的青柠键。
 */

import { Devices, Play, X } from '@phosphor-icons/react'
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
      className="glass mx-3 regular:mx-5 mt-1 mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[26px] py-2 pl-4 pr-2 text-[14px] leading-snug"
    >
      <Devices size={18} weight="fill" aria-hidden="true" className="flex-none text-leaf" />
      <span className="min-w-[10rem] flex-1 text-ink-2">
        {t('resume.prefix')}
        <span className="text-ink-3">{offer.changedBy ? `${t('common.quoteL')}${offer.changedBy}${t('common.quoteR')}` : t('resume.otherDevice')}</span>
        {t('resume.suffix')}
        <span className="mx-1 font-semibold text-ink">{current.title}</span>
        <span className="num text-ink-3">{formatDuration(offer.positionMs / 1000)}</span>
      </span>
      {/* 两个动作成一组：放不下时一起折到下一行靠右，不会把 × 单独甩在左边。视觉 36px，用伪元素把命中区撑到 44px */}
      <div className="ml-auto flex flex-none items-center gap-1">
        <Button
          size="sm"
          onClick={accept}
          className="relative flex-none before:absolute before:-inset-y-1 before:inset-x-0 before:content-['']"
        >
          <Play size={14} weight="fill" aria-hidden="true" />
          {t('resume.continue')}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={dismiss}
          aria-label={t('resume.dismiss')}
          className="relative flex-none before:absolute before:-inset-1 before:content-['']"
        >
          <X size={15} />
        </Button>
      </div>
    </div>
  )
}
