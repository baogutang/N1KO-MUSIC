import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Shuffle, Music2, Clock, Plus } from 'lucide-react'
import { usePlaylistDetail } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { getAdapter, hasAdapter } from '@/api'
import { SongList } from '@/components/music/SongList'
import { formatDuration } from '@/utils/formatters'

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: playlist, isLoading, error } = usePlaylistDetail(id!)
  const playQueue     = usePlayerStore(s => s.playQueue)
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle)
  const shuffle       = usePlayerStore(s => s.shuffle)

  function handlePlayAll() {
    if (!playlist?.songs.length) return
    if (shuffle) toggleShuffle()
    playQueue(playlist.songs, 0)
  }

  function handleShuffle() {
    if (!playlist?.songs.length) return
    if (!shuffle) toggleShuffle()
    playQueue(playlist.songs, 0)
  }

  const totalDuration = playlist?.songs.reduce((sum: number, s) => sum + (s.duration ?? 0), 0) ?? 0

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !playlist) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <Music2 className="w-12 h-12 mb-3 opacity-30" />
        <p>加载失败</p>
      </div>
    )
  }

  return (
    <div className="min-h-full pb-8">
      {/* Hero section */}
      <div className="px-6 pt-6 pb-8 bg-gradient-to-b from-primary/10 to-transparent">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground mb-6 transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        <div className="flex gap-6 items-end">
          {/* Cover */}
          <div className="w-48 h-48 rounded-xl overflow-hidden shadow-2xl flex-shrink-0">
            {playlist.coverArt ? (
              <img
                src={hasAdapter() ? getAdapter().getCoverUrl(playlist.coverArt, 400) : playlist.coverArt}
                alt={playlist.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/5 flex items-center justify-center">
                <Music2 className="w-20 h-20 text-primary/30" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">歌单</p>
            <h1 className="text-4xl font-bold mb-3 truncate">{playlist.name}</h1>
            {playlist.comment && (
              <p className="text-muted-foreground mb-3 line-clamp-2">{playlist.comment}</p>
            )}
            <div className="flex items-center gap-3 text-sm text-muted-foreground mb-6">
              <span className="flex items-center gap-1">
                <Music2 className="w-3.5 h-3.5" />
                {playlist.songs.length} 首歌曲
              </span>
              {totalDuration > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDuration(totalDuration)}
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePlayAll}
                disabled={!playlist.songs.length}
                className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                播放全部
              </button>
              <button
                onClick={handleShuffle}
                disabled={!playlist.songs.length}
                className="flex items-center gap-2 px-5 py-3 bg-muted hover:bg-muted/80 rounded-full font-medium transition-colors disabled:opacity-50"
              >
                <Shuffle className="w-4 h-4" />
                随机播放
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Song list */}
      <div className="px-6">
        {playlist.songs.length > 0 ? (
          <SongList songs={playlist.songs} showAlbum />
        ) : (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <Plus className="w-10 h-10 mb-2 opacity-30" />
            <p>歌单为空</p>
            <p className="text-sm">在歌曲旁边点击"添加到歌单"</p>
          </div>
        )}
      </div>
    </div>
  )
}
