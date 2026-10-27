/**
 * VIP 曲目标识（阶段 2.3 抽出；原先只在 SongList 里有一份内联实现）。
 *
 * 队列抽屉、播放条、全屏播放器里出现会员曲时也该有同一枚标记——
 * 用户在哪个界面看到同一首歌，得到的信号应当一致。
 *
 * 两条铁律（踩过的坑）：
 * - 不能挂在「拉丁小标签」那类会被样式规则整体隐藏的类上——VIP 是有意义的
 *   状态标记，被规则藏起来等于没有；
 * - 账号**确知**没有会员才标灰（accountVip === false）；还没问到（undefined）
 *   时不做任何暗示，宁可多标不要漏标。
 */

import { useServerStore } from '@/store/serverStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { Song } from '@/api/types'

/** 这首歌是不是会员曲（顶层 vip 与 ext.vip 同等对待） */
export function isVipSong(song: Pick<Song, 'vip' | 'ext'> | undefined | null): boolean {
  return !!(song && (song.vip || song.ext?.vip))
}

export function VipTag({
  song,
  /** 调用方已算好的「确知无会员」就传进来（SongList 每行都算过，别重复读 store） */
  accountLacksVip,
  className,
}: {
  song: Pick<Song, 'vip' | 'ext' | 'serverId'>
  accountLacksVip?: boolean
  className?: string
}) {
  const { t } = useT()
  const serverId = song.serverId
  const lacksVipInside = useServerStore(s =>
    accountLacksVip === undefined && serverId
      ? s.servers.find(x => x.id === serverId)?.accountVip === false
      : false
  )
  if (!isVipSong(song)) return null
  const grey = accountLacksVip ?? lacksVipInside
  return (
    <span
      title={grey ? t('song.vipBlockedHint') : t('song.vipHint')}
      className={cn(
        'ml-1.5 inline-block translate-y-[-1px] rounded-pill border px-1.5 align-baseline font-sans text-[10px] font-semibold leading-[1.5]',
        // 账号确知没有会员：这首多半点了也放不了，标记本身就该看起来是「灰的」
        grey ? 'border-ink-faint/40 text-ink-faint' : 'border-primary/40 text-primary',
        className
      )}
    >
      VIP
    </span>
  )
}
