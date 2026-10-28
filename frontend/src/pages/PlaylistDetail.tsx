import { useState } from 'react'
import { describeError } from '@/services/errors'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Play, Shuffle, MusicNote, DownloadSimple } from '@phosphor-icons/react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { downloadTextFile, safeFileName, toM3U, toXSPF } from '@/services/playlistFiles'
import { toast } from '@/components/ui/use-toast'
import { usePlaylistDetail, useRemoveSongsFromPlaylist } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { findAdapterFor } from '@/api'
import { DetailHero } from '@/components/common/DetailHero'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { SongList } from '@/components/music/SongList'
import { formatDuration } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'
import { SongRowsSkeleton } from '@/components/common/SongRowsSkeleton'
import { ErrorState } from '@/components/common/ErrorState'
import { useT } from '@/i18n'
import type { SourceCapabilities } from '@/api/types'
import { sourceParam } from '@/lib/sourceParam'

/**
 * 这个歌单能不能改（纯函数，测试直接覆盖）。
 *
 * 两道门，缺一不可：
 *  - 歌单所属**音源**声明了 playlistWrite——流媒体插件多半只读，
 *    对它调 removeSongsFromPlaylist 要么 404 要么静默无效；
 *  - 歌单自己不是 readonly——Navidrome 的智能歌单由规则生成，
 *    删掉一行下次刷新它又回来了。
 *
 * 此前 onRemove 是无条件传下去的：每一行都挂着「移除」，点了什么也没发生。
 */
export function canEditPlaylist(
  playlist: { serverId: string; readonly?: boolean } | undefined,
  caps: Record<string, SourceCapabilities>
): boolean {
  if (!playlist || playlist.readonly) return false
  return !!caps[playlist.serverId]?.playlistWrite
}

/** 加载骨架：与 DetailHero 同一套网格，封面方块 + 文字条，下面是曲目行 */
function PlaylistSkeleton() {
  return (
    <div className="pb-2 pt-2 regular:pt-4" aria-hidden="true">
      <div className="grid grid-cols-1 items-end justify-items-center gap-6 regular:grid-cols-[220px_minmax(0,1fr)] regular:justify-items-start regular:gap-8 wide:grid-cols-[264px_minmax(0,1fr)] wide:gap-10">
        <div className="skeleton cover-frame aspect-square w-[min(72vw,280px)] regular:w-full" />
        <div className="flex w-full min-w-0 flex-col items-center gap-3 regular:items-start">
          <div className="skeleton h-10 w-2/3 rounded-md regular:h-12" />
          <div className="skeleton h-4 w-40 rounded-md" />
          <div className="mt-2 flex gap-3">
            <div className="skeleton h-11 w-32 rounded-pill" />
            <div className="skeleton h-11 w-36 rounded-pill" />
          </div>
        </div>
      </div>
      <div className="mt-10">
        <SongRowsSkeleton rows={6} />
      </div>
    </div>
  )
}

export default function PlaylistDetail() {
  const { t } = useT()
  /**
   * 从歌单移除曲目。删除不可逆，因此走二次确认。
   * 记的是下标而不是 song：同一首歌可以在歌单里出现多次，
   * Subsonic 的接口也是按下标删的。
   */
  const removeSongs = useRemoveSongsFromPlaylist()
  const [pendingRemove, setPendingRemove] = useState<number | null>(null)
  const { id } = useParams<{ id: string }>()
  /** 跨源歌单导航带 ?src=<serverId>；单源/主库歌单没有这个参数 */
  const [searchParams] = useSearchParams()
  const srcServerId = sourceParam(searchParams)
  const navigate = useNavigate()
  const { data: playlist, isLoading, error } = usePlaylistDetail(id!, srcServerId)
  const sourceCaps = useSourceCapabilities()
  const editable = canEditPlaylist(playlist, sourceCaps)

  function handlePlayAll() {
    if (!playlist?.songs.length) return
    playAllInOrder(playlist.songs, 0)
  }

  function handleShuffle() {
    if (!playlist?.songs.length) return
    playAllShuffled(playlist.songs, 0)
  }

  /** 导出：整段在浏览器里完成，文件不经过任何服务器 */
  function handleExport(format: 'm3u' | 'xspf') {
    if (!playlist?.songs.length) return
    const base = safeFileName(playlist.name)
    if (format === 'm3u') {
      downloadTextFile(`${base}.m3u8`, toM3U(playlist.songs, playlist.name), 'audio/x-mpegurl')
    } else {
      downloadTextFile(`${base}.xspf`, toXSPF(playlist.songs, playlist.name), 'application/xspf+xml')
    }
    toast({ title: t('playlist.exported', { count: playlist.songs.length }) })
  }

  const totalDuration = playlist?.songs.reduce((sum: number, s) => sum + (s.duration ?? 0), 0) ?? 0

  if (isLoading) {
    return <PlaylistSkeleton />
  }

  if (error || !playlist) {
    return (
      <div className="pt-2 regular:pt-4">
        <ErrorState onBack={() => navigate(-1)} />
      </div>
    )
  }

  /* 大图 480 保证封面在高分屏上清楚；取色只要小图，且与卡片同一张，缓存能直接命中 */
  const coverAdapter = findAdapterFor(playlist.serverId)
  const coverSrc = playlist.coverArt
    ? (coverAdapter?.getCoverUrl(playlist.coverArt, 480) ?? playlist.coverArt)
    : undefined
  const paletteUrl = playlist.coverArt
    ? (coverAdapter?.getCoverUrl(playlist.coverArt, 300) ?? playlist.coverArt)
    : undefined

  return (
    <div>
      {/* 头部：DetailHero——歌单封面带着自己的光，说明在标题下面。
          元信息里来源在前：混源之后「这是谁家的歌单」是理解本页一切行为的前提，
          包括为什么这里没有「移除」 */}
      <DetailHero
        cover={
          coverSrc ? (
            <img
              src={coverSrc}
              alt={playlist.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-ink-3">
              <MusicNote className="h-1/3 w-1/3" aria-hidden="true" />
            </div>
          )
        }
        coverUrl={paletteUrl}
        title={spaceCJK(playlist.name)}
        subtitle={
          playlist.comment ? (
            <p className="line-clamp-2 max-w-[52ch] text-[15px] font-normal text-ink-2">{playlist.comment}</p>
          ) : undefined
        }
        meta={
          <>
            <SourceBadge serverId={playlist.serverId} withName />
            <span>{t('song.count', { count: playlist.songs.length })}</span>
            {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
          </>
        }
        actions={
          <>
            {/* 动作行：播放（青柠，一屏唯一）/ 随机、导出（中性胶囊） */}
            <Button type="button" onClick={handlePlayAll} disabled={!playlist.songs.length}>
              <Play size={18} weight="fill" />
              {t('player.playAll')}
            </Button>
            <Button type="button" variant="secondary" onClick={handleShuffle} disabled={!playlist.songs.length}>
              <Shuffle size={18} />
              {t('player.shuffle')}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" disabled={!playlist.songs.length}>
                  <DownloadSimple size={18} />
                  {t('action.export')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => handleExport('m3u')}>
                  M3U8<span className="ml-2 text-[13px] text-ink-3">{t('playlist.exportM3uHint')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('xspf')}>
                  XSPF<span className="ml-2 text-[13px] text-ink-3">{t('playlist.exportXspfHint')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {/* 曲目列表：不画分隔线，靠行距与 hover 底 */}
      <div className="mt-10">
        {playlist.songs.length > 0 ? (
          // 只在真能改的时候才给「移除」：挂一个点了没反应的入口比没有更糟
          <SongList songs={playlist.songs} showAlbum onRemove={editable ? setPendingRemove : undefined} />
        ) : (
          <EmptyState
            title={t('empty.playlistDetail.title')}
            description={t('empty.playlistDetail.description')}
          />
        )}
      </div>

      <Dialog open={pendingRemove !== null} onOpenChange={open => { if (!open) setPendingRemove(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('playlist.removeSong')}</DialogTitle>
            <DialogDescription>
              {pendingRemove !== null && playlist?.songs[pendingRemove]
                ? t('playlist.removeSongConfirm', { title: playlist.songs[pendingRemove].title })
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setPendingRemove(null)}>
              {t('action.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={removeSongs.isPending}
              onClick={async () => {
                if (pendingRemove === null || !id) return
                try {
                  await removeSongs.mutateAsync({ playlistId: id, songIndexes: [pendingRemove], serverId: srcServerId })
                  toast({ title: t('playlist.removedSong') })
                } catch (err) {
                  toast({
                    title: t('playlist.removeSongFailed'),
                    description: describeError(err),
                    variant: 'destructive',
                  })
                } finally {
                  setPendingRemove(null)
                }
              }}
            >
              {removeSongs.isPending ? t('queue.saving') : t('action.remove')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
