/**
 * 专辑详情页
 * 展示专辑封面、信息、歌曲列表
 */

import { useParams } from 'react-router-dom'
import { Play, Shuffle, Heart, MoreHorizontal } from 'lucide-react'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAlbumDetail } from '@/hooks/useServerQueries'
import { usePlayerStore } from '@/store/playerStore'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { formatDuration, formatDurationNatural } from '@/utils/formatters'

export default function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: album, isLoading } = useAlbumDetail(id ?? '')
  const playQueue = usePlayerStore(s => s.playQueue)

  const coverUrl = album?.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(album.coverArt, 400)
    : undefined

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (!album) return null

  const totalDuration = album.songs.reduce((s, r) => s + r.duration, 0)

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto">
          {/* 专辑 Header */}
          <div className="p-6 flex gap-6 items-end">
            {/* 封面 */}
            <div className="w-40 h-40 lg:w-56 lg:h-56 rounded-2xl overflow-hidden shadow-2xl flex-shrink-0">
              <ImageWithFallback
                src={coverUrl}
                alt={album.name}
                fallbackType="album"
                className="w-full h-full"
                customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
              />
            </div>

            {/* 信息 */}
            <div className="flex-1 min-w-0 pb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">专辑</p>
              <h1 className="text-2xl lg:text-4xl font-bold text-foreground line-clamp-2 mb-2">
                {album.name}
              </h1>
              <p className="text-base text-muted-foreground mb-3">{album.artist}</p>
              <div className="flex items-center gap-3 flex-wrap">
                {album.year && (
                  <Badge variant="secondary">{album.year}</Badge>
                )}
                {album.genre && (
                  <Badge variant="outline">{album.genre}</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {album.songs.length} 首歌曲 · {formatDurationNatural(totalDuration)}
                </span>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-3 mt-5">
                <Button
                  size="lg"
                  className="rounded-full"
                  onClick={() => playQueue(album.songs)}
                >
                  <Play className="w-5 h-5 mr-2" fill="currentColor" />
                  播放全部
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  className="rounded-full"
                  onClick={() => {
                    const shuffled = [...album.songs].sort(() => Math.random() - 0.5)
                    playQueue(shuffled)
                  }}
                >
                  <Shuffle className="w-5 h-5 mr-2" />
                  随机播放
                </Button>
                <button className="p-2 rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
                  <Heart className="w-5 h-5" />
                </button>
                <button className="p-2 rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* 歌曲列表 */}
          <div className="px-6 pb-8">
            {/* 表头 */}
            <div className="flex items-center gap-4 px-4 py-2 text-xs text-muted-foreground border-b border-border/50 mb-2">
              <span className="w-8 text-center">#</span>
              <span className="flex-1">标题</span>
              <span className="hidden lg:block flex-1">专辑</span>
              <span className="w-12 text-right">时长</span>
              <span className="w-8" />
            </div>
            <SongList
              songs={album.songs}
              showCover={false}
              showAlbum={false}
              showIndex
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
