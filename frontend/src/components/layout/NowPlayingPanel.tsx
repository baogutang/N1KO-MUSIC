/**
 * 宽窗口右侧的「正在播放」面板。
 *
 * 参考特斯拉 App 的平板布局：一侧是你在操作的东西，另一侧一直摆着那台车——
 * 这里一直摆着的是正在放的这首歌：大封面、几行滚动歌词、接下来要播的歌。
 * 点封面进全屏；歌曲能从任何列表拖进「接下来」（iPadOS 长按拖、桌面直接拖）。
 * 开关在工具栏右端（⌥⌘P），窗口 ≥1180 时默认展开。
 *
 * 外壳只在有歌的时候才挂它（MainLayout 的 showPanel），所以这里没有空态。
 * 外形与左边的侧栏一对：同样浮起的 22px 圆角第二中性面，同样的安全区边距。
 */

import { useNavigate } from 'react-router-dom'
import { X } from '@phosphor-icons/react'
import { usePlayerStore } from '@/store/playerStore'
import { useThemeStore } from '@/store/themeStore'
import { useLyricsQuery, useToggleStar } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import { findAdapterFor } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { LyricDisplay } from '@/components/player/LyricDisplay'
import { HeartGlyph } from '@/components/player/glyphs'
import { detailPath } from '@/utils/detailPath'
import { spaceCJK } from '@/utils/cjkTypography'
import { UpNextList } from '@/components/player/UpNextList'
import { useT } from '@/i18n'

const UP_NEXT_COUNT = 8

export function NowPlayingPanel() {
  const { t } = useT()
  const navigate = useNavigate()
  const currentSong = usePlayerStore(s => s.currentSong)
  const setFullscreen = usePlayerStore(s => s.setFullscreen)
  const setQueueOpen = usePlayerStore(s => s.setQueueOpen)
  const updateCurrentSong = usePlayerStore(s => s.updateCurrentSong)
  const setNowPlayingPanel = useThemeStore(s => s.setNowPlayingPanel)
  const toggleStar = useToggleStar()
  const caps = useSourceCapabilities()

  const lyricsQuery = useLyricsQuery(
    currentSong?.id ?? '',
    currentSong?.title,
    currentSong?.artist,
    currentSong?.album,
    currentSong?.path,
    currentSong?.duration,
    !!currentSong,
    currentSong?.serverId
  )

  const coverUrl = currentSong?.coverArt
    ? findAdapterFor(currentSong.serverId)?.getCoverUrl(currentSong.coverArt, 600) ?? undefined
    : undefined
  const canFavorite = sourceSupportsFavorites(caps, currentSong?.serverId)

  // 外壳保证有歌才挂面板；这一行只是给类型收窄，不是空态
  if (!currentSong) return null

  return (
    <aside
      aria-label={t('player.nowPlaying')}
      className="col-start-3 row-start-1 m-2.5 ml-0 flex min-h-0 flex-col overflow-hidden rounded-[22px] bg-surface-2/75 shadow-hair"
      style={{
        marginTop: 'calc(env(safe-area-inset-top) + 10px)',
        marginRight: 'calc(env(safe-area-inset-right) + 10px)',
        /* 底部让开横跨内容与面板的播放条（--dock-h 是它实测的高度） */
        marginBottom: 'calc(var(--dock-h, 96px) + 8px)',
      }}
    >
      {/* 与侧栏的头部同高（60px），两块面板的第一行在一条线上 */}
      <div className="flex h-[60px] flex-none items-center justify-between pl-5 pr-2.5">
        <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-ink">{t('player.nowPlaying')}</h2>
        <button
          onClick={() => setNowPlayingPanel(false)}
          className="press-pop relative grid h-9 w-9 place-items-center rounded-pill text-ink-3 before:absolute before:-inset-1 before:content-[''] hover:bg-ink/[0.06] hover:text-ink"
          aria-label={t('shell.hidePanel')}
        >
          <X size={17} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5 pt-1 scrollbar-hide">
        <button
          onClick={() => setFullscreen(true)}
          className="press-pop cover-frame block aspect-square w-full flex-none shadow-cover"
          aria-label={t('player.openNowPlaying')}
        >
          <ImageWithFallback
            src={coverUrl}
            alt={currentSong.album}
            fallbackType="album"
            className="h-full w-full"
            songId={currentSong.id}
            customCoverParams={{ type: 'song', title: currentSong.title, artist: currentSong.artist, album: currentSong.album, path: currentSong.path }}
          />
        </button>

        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-display text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
              {spaceCJK(currentSong.title)}
            </p>
            <div className="mt-1.5 flex min-w-0 flex-col items-start gap-0.5">
              <button
                className="max-w-full truncate text-[15px] font-medium text-ink-3 hover:text-leaf hover:underline"
                onClick={() => currentSong.artistId && navigate(detailPath('artists', currentSong.artistId, currentSong.serverId))}
              >
                {spaceCJK(currentSong.artist)}
              </button>
              {currentSong.album && (
                <button
                  className="max-w-full truncate text-[13px] text-ink-3 hover:text-leaf hover:underline"
                  onClick={() => currentSong.albumId && navigate(detailPath('albums', currentSong.albumId, currentSong.serverId))}
                >
                  {spaceCJK(currentSong.album)}
                </button>
              )}
            </div>
          </div>
          {canFavorite && (
            <button
              onClick={() => toggleStar.mutate(
                { id: currentSong.id, type: 'song', isStarred: !!currentSong.starred, song: currentSong },
                { onSuccess: () => updateCurrentSong({ starred: !currentSong.starred }) }
              )}
              disabled={toggleStar.isPending}
              className="press-pop -mt-1 grid h-11 w-11 flex-none place-items-center rounded-pill text-ink-3 hover:bg-ink/[0.06] hover:text-ink aria-pressed:text-ink disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              aria-label={t(currentSong.starred ? 'player.unfavorite' : 'player.favorite')}
              aria-pressed={!!currentSong.starred}
            >
              <HeartGlyph on={!!currentSong.starred} size={22} />
            </button>
          )}
        </div>

        {/* 歌词预览：不装进盒子，上下由 lyric-fade 渐隐；-mx-4 抵掉 LyricDisplay 自带的横向内边距，字和标题对齐 */}
        <div className="-mx-4 h-[188px] flex-none overflow-hidden">
          {lyricsQuery.data ? (
            <LyricDisplay lines={lyricsQuery.data.lines} variant="panel" className="h-full" />
          ) : (
            <p className="grid h-full place-items-center px-4 text-center text-[13px] text-ink-3">
              {lyricsQuery.isLoading ? t('lyrics.loading') : lyricsQuery.isError ? t('lyrics.loadFailed') : t('lyrics.none')}
            </p>
          )}
        </div>

        <UpNextList count={UP_NEXT_COUNT} onOpenQueue={() => setQueueOpen(true)} />
      </div>
    </aside>
  )
}
