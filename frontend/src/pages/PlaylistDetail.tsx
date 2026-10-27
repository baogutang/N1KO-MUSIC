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

/** 头部两栏：compact 封面在上；regular 左 260；wide 左 300 */
const HEADER_GRID = 'grid grid-cols-1 items-end gap-6 regular:grid-cols-[260px_minmax(0,1fr)] regular:gap-8 wide:grid-cols-[300px_minmax(0,1fr)] wide:gap-10'

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
    return (
      <div className="pt-2 regular:pt-4 animate-fade-in" aria-hidden="true">
        <div className={HEADER_GRID}>
          <div className="aspect-square w-full max-w-[300px] rounded-md bg-skeleton animate-pulse regular:max-w-none" />
          <div className="space-y-4">
            <div className="h-10 w-2/3 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-3.5 w-40 rounded-sm bg-skeleton animate-pulse" />
            <div className="flex gap-3 pt-3">
              <div className="h-11 w-28 rounded-pill bg-skeleton animate-pulse" />
              <div className="h-11 w-32 rounded-pill bg-skeleton animate-pulse" />
            </div>
          </div>
        </div>
        <div className="mt-10">
          <SongRowsSkeleton rows={6} />
        </div>
      </div>
    )
  }

  if (error || !playlist) {
    return (
      <div className="pt-2 regular:pt-4 animate-fade-in">
        <ErrorState onBack={() => navigate(-1)} />
      </div>
    )
  }

  return (
    <div className="pt-2 regular:pt-4 animate-fade-in">
      {/* 头部：wide / regular 两栏（左大封面，右歌单名 + 元信息 + 动作行），compact 封面在上 */}
      <header className={HEADER_GRID}>
        <div className="cover-slab flex aspect-square w-full max-w-[300px] items-center justify-center overflow-hidden bg-paper-deep regular:max-w-none">
          {playlist.coverArt ? (
            <img
              src={findAdapterFor(playlist.serverId)?.getCoverUrl(playlist.coverArt, 480) ?? playlist.coverArt}
              alt={playlist.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <MusicNote className="h-16 w-16 text-ink-faint" />
          )}
        </div>

        <div className="min-w-0">
          <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">
            {spaceCJK(playlist.name)}
          </h1>
          {playlist.comment && (
            <p className="mt-3 max-w-[52ch] text-sm text-ink-soft line-clamp-2">{playlist.comment}</p>
          )}
          {/* 元信息：来源在前——混源之后「这是谁家的歌单」是理解本页一切行为的前提，
              包括为什么这里没有「移除」 */}
          <p className="num mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-faint">
            <SourceBadge serverId={playlist.serverId} withName />
            <span>{t('song.count', { count: playlist.songs.length })}</span>
            {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
          </p>

          {/* 动作行：播放（强调色实心）/ 随机、导出（纸片胶囊） */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={handlePlayAll}
              disabled={!playlist.songs.length}
              className="act-primary inline-flex items-center gap-2 text-sm"
            >
              <Play size={15} weight="fill" />
              {t('player.playAll')}
            </button>
            <button
              onClick={handleShuffle}
              disabled={!playlist.songs.length}
              className="act-secondary inline-flex items-center gap-2 text-sm"
            >
              <Shuffle size={15} />
              {t('player.shuffle')}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={!playlist.songs.length}
                className="act-secondary inline-flex items-center gap-2 text-sm"
              >
                <DownloadSimple size={15} />
                {t('action.export')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => handleExport('m3u')}>
                  M3U8<span className="ml-2 text-[13px] text-ink-faint">{t('playlist.exportM3uHint')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('xspf')}>
                  XSPF<span className="ml-2 text-[13px] text-ink-faint">{t('playlist.exportXspfHint')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* 曲目列表：不画分隔线，靠行距与 hover 底 */}
      <div className="mt-10">
        {playlist.songs.length > 0 ? (
          // 只在真能改的时候才给「移除」：挂一个点了没反应的入口比没有更糟
          <SongList songs={playlist.songs} showAlbum onRemove={editable ? setPendingRemove : undefined} />
        ) : (
          <EmptyState
            ruled
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
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
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
