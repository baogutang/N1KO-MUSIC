/**
 * 专辑详情页
 * 展示专辑封面、信息、歌曲列表
 */

import { useParams } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Play, Shuffle, Heart } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAlbumDetail, useToggleStar } from '@/hooks/useServerQueries'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { formatDurationNatural } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { cn } from '@/lib/utils'

export default function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: album, isLoading } = useAlbumDetail(id ?? '')
  const toggleStar = useToggleStar()
  const [starred, setStarred] = useState(false)

  useEffect(() => {
    if (album) setStarred(!!album.starred)
  }, [album])

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

  if (!album) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
        <p>专辑不存在或加载失败</p>
      </div>
    )
  }

  const totalDuration = album.songs.reduce((s, r) => s + r.duration, 0)

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto animate-fade-in">
          {/* 专辑 Header */}
          <div className="px-8 pt-10 pb-8 flex gap-8 items-end">
            {/* 封面 */}
            <div className="relative w-40 h-40 lg:w-56 lg:h-56 flex-shrink-0">
              <div aria-hidden className="absolute inset-[10%] rounded-[40%] bg-primary/20 blur-[48px]" />
              <div className="relative w-full h-full rounded-lg overflow-hidden ring-1 ring-border shadow-2xl shadow-black/40">
                <ImageWithFallback
                  src={coverUrl}
                  alt={album.name}
                  fallbackType="album"
                  className="w-full h-full"
                  customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
                />
              </div>
            </div>

            {/* 信息 */}
            <div className="flex-1 min-w-0 pb-1">
              <p className="text-[11.5px] uppercase tracking-[0.14em] text-primary mb-2">专辑</p>
              <h1 className="text-2xl lg:text-4xl font-bold tracking-tight text-foreground line-clamp-2 mb-2">
                {album.name}
              </h1>
              <p className="text-base text-muted-foreground mb-3 truncate">{album.artist}</p>
              <div className="flex items-center gap-2 flex-wrap text-sm text-muted-foreground">
                {album.year && (
                  <>
                    <span className="font-num">{album.year}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                {album.genre && (
                  <>
                    <span>{album.genre}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span>
                  <span className="font-num">{album.songs.length}</span> 首歌曲 · <span className="font-num">{formatDurationNatural(totalDuration)}</span>
                </span>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-3 mt-6">
                <button
                  onClick={() => playAllInOrder(album.songs)}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors active:scale-[0.97]"
                >
                  <Play size={16} weight="fill" />
                  播放全部
                </button>
                <button
                  onClick={() => playAllShuffled(album.songs)}
                  className="inline-flex items-center gap-2 h-10 px-5 rounded-full border border-border text-sm font-semibold text-foreground hover:border-primary hover:text-primary transition-colors active:scale-[0.97]"
                >
                  <Shuffle size={16} />
                  随机播放
                </button>
                <button
                  onClick={() => {
                    if (!id) return
                    const next = !starred
                    setStarred(next)
                    toggleStar.mutate(
                      { id, type: 'album', isStarred: !next },
                      { onError: () => setStarred(!next) }
                    )
                  }}
                  className={cn(
                    'w-10 h-10 grid place-items-center rounded-full transition-colors hover:bg-accent active:scale-[0.94]',
                    starred ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                  aria-label={starred ? '取消收藏专辑' : '收藏专辑'}
                >
                  <Heart size={20} weight={starred ? 'fill' : 'regular'} />
                </button>
              </div>
            </div>
          </div>

          {/* 歌曲列表 */}
          <div className="px-8 pb-10 border-t border-border pt-4">
            {/* 表头 */}
            <div className="flex items-center gap-4 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border mb-2">
              <span className="w-8 text-center font-num">#</span>
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
