import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Shuffle, MusicNote, DownloadSimple } from '@phosphor-icons/react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { downloadTextFile, safeFileName, toM3U, toXSPF } from '@/services/playlistFiles'
import { toast } from '@/components/ui/use-toast'
import { usePlaylistDetail } from '@/hooks/useServerQueries'
import { getAdapter, hasAdapter } from '@/api'
import { SongList } from '@/components/music/SongList'
import { formatDuration } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { EmptyState } from '@/components/common/EmptyState'

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: playlist, isLoading, error } = usePlaylistDetail(id!)

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
    toast({ title: `已导出 ${playlist.songs.length} 首` })
  }

  const totalDuration = playlist?.songs.reduce((sum: number, s) => sum + (s.duration ?? 0), 0) ?? 0

  const backLink = (
    <button
      onClick={() => navigate(-1)}
      className="inline-flex items-center gap-1.5 text-xs tracking-[0.14em] text-ink-soft transition-all duration-200 hover:text-primary hover:-translate-x-0.5 active:scale-[0.97]"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      返回
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
        <EmptyState title="加载失败。" description="请检查网络连接后重试。" />
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
              src={hasAdapter() ? getAdapter().getCoverUrl(playlist.coverArt, 480) : playlist.coverArt}
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
          <p className="mb-4 flex items-center gap-3 text-[11px] tracking-[0.3em] text-primary">
            歌单 · PLAYLIST
            <span className="h-px w-10 bg-primary" aria-hidden="true" />
          </p>
          <h1 className="font-serif text-4xl md:text-5xl font-black leading-[1.1] tracking-[-0.01em] text-balance">
            {spaceCJK(playlist.name)}
          </h1>
          {playlist.comment && (
            <p className="mt-3 max-w-[52ch] text-sm text-ink-soft line-clamp-2">{playlist.comment}</p>
          )}
          <p className="mt-4 font-num text-xs tracking-[0.06em] text-ink-faint">
            {playlist.songs.length} 首{totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
          </p>

          {/* 文字级操作行：主操作下划线，hover 变 accent（DESIGN v2 §4.1） */}
          <div className="mt-7 flex items-center gap-8">
            <button
              onClick={handlePlayAll}
              disabled={!playlist.songs.length}
              className="inline-flex items-center gap-2.5 border-b border-ink pb-1.5 text-sm font-semibold tracking-[0.12em] transition-colors hover:border-primary hover:text-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5" weight="fill" />
              播放全部
            </button>
            <button
              onClick={handleShuffle}
              disabled={!playlist.songs.length}
              className="inline-flex items-center gap-2 text-sm tracking-[0.12em] text-ink-soft transition-colors hover:text-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
            >
              <Shuffle className="w-4 h-4" />
              随机播放
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={!playlist.songs.length}
                className="inline-flex items-center gap-2 text-sm tracking-[0.12em] text-ink-soft transition-colors hover:text-primary active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
              >
                <DownloadSimple className="w-4 h-4" />
                导出
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => handleExport('m3u')}>
                  M3U8<span className="ml-2 text-[11px] text-ink-faint">通用</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('xspf')}>
                  XSPF<span className="ml-2 text-[11px] text-ink-faint">保留元数据</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* 曲目列表：SongList 自带 border-t border-hair，不再加容器边框 */}
      {playlist.songs.length > 0 ? (
        <SongList songs={playlist.songs} showAlbum />
      ) : (
        <EmptyState
          ruled
          title="歌单还是空的。"
          description="在歌曲菜单里选择「添加到歌单」。"
        />
      )}
    </div>
  )
}
