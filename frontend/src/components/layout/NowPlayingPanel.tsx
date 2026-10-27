/**
 * 宽窗口右侧的「正在播放」面板。
 *
 * 参考特斯拉 App 的平板布局：一侧是你在操作的东西，另一侧一直摆着那台车——
 * 这里一直摆着的是正在放的这首歌：大封面、几行滚动歌词、接下来要播的歌。
 * 点封面进全屏；歌曲能从任何列表拖进「接下来」（iPadOS 长按拖、桌面直接拖）。
 * 开关在工具栏右端（⌥⌘P），窗口 ≥1180 时默认展开。
 */

import { useNavigate } from 'react-router-dom'
import { Heart, X } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { usePlayerStore } from '@/store/playerStore'
import { useThemeStore } from '@/store/themeStore'
import { useLyricsQuery, useToggleStar } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { sourceSupportsFavorites } from '@/services/heartCapability'
import { findAdapterFor } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { LyricDisplay } from '@/components/player/LyricDisplay'
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

  return (
    <aside
      aria-label={t('player.nowPlaying')}
      className="sheet col-start-3 row-start-1 m-2 ml-0 flex min-h-0 flex-col overflow-hidden"
      style={{
        marginTop: 'calc(env(safe-area-inset-top) + 8px)',
        marginRight: 'calc(env(safe-area-inset-right) + 8px)',
        marginBottom: 'calc(var(--dock-h, 96px) + 4px)',
      }}
    >
      <div className="flex flex-none items-center justify-between py-2 pl-5 pr-2">
        <h2 className="text-[16px] font-semibold text-ink">{t('player.nowPlaying')}</h2>
        <button
          onClick={() => setNowPlayingPanel(false)}
          className="grid h-9 w-9 place-items-center rounded-pill text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink"
          aria-label={t('shell.hidePanel')}
        >
          <X size={16} />
        </button>
      </div>

      {!currentSong ? (
        <div className="paper-grid mx-4 mb-4 flex flex-1 flex-col items-center justify-center gap-1.5 rounded-md px-6 text-center">
          <p className="text-[15px] font-semibold text-ink">{t('shell.panelEmpty')}</p>
          <p className="text-[13.5px] text-ink-faint">{t('player.selectToStart')}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5 scrollbar-hide">
          <button
            onClick={() => setFullscreen(true)}
            className="cover-slab block aspect-square w-full flex-none overflow-hidden"
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
              <p className="line-clamp-2 text-[19px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                {spaceCJK(currentSong.title)}
              </p>
              <p className="mt-1 flex min-w-0 flex-wrap gap-x-2 text-[13.5px] text-ink-faint">
                <button
                  className="truncate hover:text-primary"
                  onClick={() => currentSong.artistId && navigate(detailPath('artists', currentSong.artistId, currentSong.serverId))}
                >
                  {spaceCJK(currentSong.artist)}
                </button>
                {currentSong.album && (
                  <button
                    className="truncate hover:text-primary"
                    onClick={() => currentSong.albumId && navigate(detailPath('albums', currentSong.albumId, currentSong.serverId))}
                  >
                    {spaceCJK(currentSong.album)}
                  </button>
                )}
              </p>
            </div>
            {canFavorite && (
              <button
                onClick={() => toggleStar.mutate(
                  { id: currentSong.id, type: 'song', isStarred: !!currentSong.starred, song: currentSong },
                  { onSuccess: () => updateCurrentSong({ starred: !currentSong.starred }) }
                )}
                disabled={toggleStar.isPending}
                className={cn(
                  'grid h-10 w-10 flex-none place-items-center rounded-pill transition-colors hover:bg-paper-deep',
                  currentSong.starred ? 'text-sem-fav' : 'text-ink-faint'
                )}
                aria-label={t(currentSong.starred ? 'player.unfavorite' : 'player.favorite')}
                aria-pressed={!!currentSong.starred}
              >
                <Heart size={20} weight={currentSong.starred ? 'fill' : 'regular'} />
              </button>
            )}
          </div>

          {/* 歌词落在格纸上：签名的那张工作纸 */}
          <div className="paper-grid h-[188px] flex-none overflow-hidden rounded-md">
            {lyricsQuery.data ? (
              <LyricDisplay lines={lyricsQuery.data.lines} variant="panel" className="h-full" />
            ) : (
              <p className="grid h-full place-items-center px-4 text-center text-[13px] text-ink-faint">
                {lyricsQuery.isLoading ? t('lyrics.loading') : lyricsQuery.isError ? t('lyrics.loadFailed') : t('lyrics.none')}
              </p>
            )}
          </div>

          <UpNextList count={UP_NEXT_COUNT} onOpenQueue={() => setQueueOpen(true)} />
        </div>
      )}
    </aside>
  )
}
