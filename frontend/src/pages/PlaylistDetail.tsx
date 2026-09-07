import { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Play, Shuffle, MusicNote, DownloadSimple } from '@phosphor-icons/react'
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

  const backLink = (
    <button
      onClick={() => navigate(-1)}
      className="inline-flex items-center gap-1.5 text-xs tracking-[0.14em] text-ink-soft transition-all duration-200 hover:text-primary hover:-translate-x-0.5 active:scale-[0.97]"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      {t('action.back')}
    </button>
  )

  if (isLoading) {
    return (
      <div className="pt-6 animate-fade-in">
        {backLink}
        <div className="mt-8 flex flex-col gap-8 pb-10 sm:flex-row sm:items-end sm:gap-10">
          <div className="w-[240px] aspect-square flex-shrink-0 rounded-md bg-paper-deep animate-pulse" />
          <div className="flex-1 space-y-4 pb-1">
            <div className="h-3 w-28 rounded-sm bg-paper-deep animate-pulse" />
            <div className="h-12 w-2/3 rounded-sm bg-paper-deep animate-pulse" />
            <div className="h-4 w-40 rounded-sm bg-paper-deep animate-pulse" />
          </div>
        </div>
        <div className="border-t border-hair divide-y divide-hair-soft">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-3 py-2.5">
              <div className="h-4 w-6 rounded-sm bg-paper-deep animate-pulse" />
              <div className="h-10 w-10 rounded-sm bg-paper-deep animate-pulse" />
              <div className="h-4 flex-1 rounded-sm bg-paper-deep animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !playlist) {
    return (
      <div className="pt-6 animate-fade-in">
        {backLink}
        <EmptyState title={t('empty.loadFailed.title')} description={t('empty.loadFailed.description')} />
      </div>
    )
  }

  return (
    <div className="pt-6 animate-fade-in">
      {backLink}

      {/* 头部：左封面 + 右衬线 900 歌单名（DESIGN v2 §3 专辑详情范式） */}
      <header className="mt-8 flex flex-col gap-8 pb-10 sm:flex-row sm:items-end sm:gap-10">
        <div className="w-[240px] aspect-square flex-shrink-0 overflow-hidden rounded-md ring-1 ring-hair-soft shadow-float bg-paper-deep">
          {playlist.coverArt ? (
            <img
              src={findAdapterFor(playlist.serverId)?.getCoverUrl(playlist.coverArt, 480) ?? playlist.coverArt}
              alt={playlist.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <MusicNote className="w-16 h-16 text-ink-faint/40" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 pb-1">
          {/* 页眉带来源：混源之后「这是谁家的歌单」是理解本页一切行为的前提，
              包括为什么这里没有「移除」 */}
          <p className="mb-4 flex items-center gap-3 text-[11px] tracking-[0.3em] text-primary">
            {t('playlist.kicker')}
            <span className="h-px w-10 bg-primary" aria-hidden="true" />
            <SourceBadge serverId={playlist.serverId} withName className="tracking-[0.08em]" />
          </p>
          <h1 className="font-serif text-4xl md:text-5xl font-black leading-[1.1] tracking-[-0.01em] text-balance">
            {spaceCJK(playlist.name)}
          </h1>
          {playlist.comment && (
            <p className="mt-3 max-w-[52ch] text-sm text-ink-soft line-clamp-2">{playlist.comment}</p>
          )}
          <p className="mt-4 font-num text-xs tracking-[0.06em] text-ink-faint">
            {totalDuration > 0
              ? t('playlist.countWithDuration', {
                  count: playlist.songs.length,
                  duration: formatDuration(totalDuration),
                })
              : t('song.count', { count: playlist.songs.length })}
          </p>

          {/* 文字级操作行：主操作下划线，hover 变 accent（DESIGN v2 §4.1） */}
          <div className="mt-7 flex items-center gap-8">
            <button
              onClick={handlePlayAll}
              disabled={!playlist.songs.length}
              className="act-primary inline-flex items-center gap-2.5 border-b border-ink pb-1.5 text-sm font-semibold tracking-[0.12em] transition-colors hover:border-primary hover:text-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5" weight="fill" />
              {t('player.playAll')}
            </button>
            <button
              onClick={handleShuffle}
              disabled={!playlist.songs.length}
              className="inline-flex items-center gap-2 text-sm tracking-[0.12em] text-ink-soft transition-colors hover:text-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              <Shuffle className="w-4 h-4" />
              {t('player.shuffle')}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={!playlist.songs.length}
                className="inline-flex items-center gap-2 text-sm tracking-[0.12em] text-ink-soft transition-colors hover:text-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
              >
                <DownloadSimple className="w-4 h-4" />
                {t('action.export')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => handleExport('m3u')}>
                  M3U8<span className="ml-2 text-[11px] text-ink-faint">{t('playlist.exportM3uHint')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('xspf')}>
                  XSPF<span className="ml-2 text-[11px] text-ink-faint">{t('playlist.exportXspfHint')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* 曲目列表：SongList 自带 border-t border-hair，不再加容器边框 */}
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

      <Dialog open={pendingRemove !== null} onOpenChange={open => { if (!open) setPendingRemove(null) }}>
        <DialogContent className="sm:max-w-sm">
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
                    description: err instanceof Error ? err.message : undefined,
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
