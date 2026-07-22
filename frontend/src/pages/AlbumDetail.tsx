/**
 * 专辑详情页 —— demo 专辑范式（DESIGN v2 §3，demo-editorial .album-head）
 * 左大封面（圆角 6px + 唯一允许的浮层淡投影）｜右元信息：衬线 900 专辑名、
 * 歌手链接、mono 年份·曲目数·总时长、文字级操作行；下方曲目表 = SongList（自带 border-t）
 */

import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { Play, Shuffle, Heart } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { useAlbumDetail, useToggleStar } from '@/hooks/useServerQueries'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { getAdapter, hasAdapter } from '@/api'
import { formatDurationNatural } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { cn } from '@/lib/utils'

export default function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: album, isLoading } = useAlbumDetail(id ?? '')
  const toggleStar = useToggleStar()
  const [starred, setStarred] = useState(false)

  useEffect(() => {
    if (album) setStarred(!!album.starred)
  }, [album])

  const coverUrl = album?.coverArt && hasAdapter()
    ? getAdapter().getCoverUrl(album.coverArt, 600)
    : undefined

  if (isLoading) {
    return (
      <div className="pt-10 animate-fade-in">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[280px_minmax(0,1fr)] lg:gap-14">
          <div className="aspect-square w-60 max-w-[320px] rounded-md bg-hair-soft animate-pulse md:w-full" />
          <div className="space-y-4 pt-2">
            <div className="h-3 w-28 rounded-sm bg-hair-soft animate-pulse" />
            <div className="h-12 w-2/3 rounded-sm bg-hair-soft animate-pulse" />
            <div className="h-3 w-40 rounded-sm bg-hair-soft animate-pulse" />
            <div className="h-3 w-56 rounded-sm bg-hair-soft animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!album) {
    return (
      <div className="pt-24 text-center">
        <p className="font-serif text-xl text-ink-soft">专辑不存在或加载失败。</p>
      </div>
    )
  }

  const totalDuration = album.songs.reduce((s, r) => s + r.duration, 0)

  return (
    <div className="pt-10 animate-fade-in">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[280px_minmax(0,1fr)] lg:gap-14">
        {/* 左：大封面（240–320px、圆角 6px、shadow-float，DESIGN §1.3 唯一允许的投影） */}
        <div className="w-60 max-w-[320px] md:w-full">
          <div className="aspect-square overflow-hidden rounded-md ring-1 ring-hair-soft shadow-float">
            <ImageWithFallback
              src={coverUrl}
              alt={album.name}
              fallbackType="album"
              className="w-full h-full"
              customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
            />
          </div>
        </div>

        {/* 右：元信息 */}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.3em] text-primary">专辑 · ALBUM</p>
          <h1 className="mt-3 font-serif text-[40px] font-black leading-[1.1] tracking-[-0.01em] text-ink text-balance lg:text-[52px]">
            {album.name}
          </h1>
          <p className="mt-3 text-sm tracking-[0.06em] text-ink-soft">
            {album.artistId ? (
              <button
                onClick={() => navigate(`/artists/${album.artistId}`)}
                className="border-b border-hair pb-0.5 transition-colors duration-200 hover:border-primary hover:text-primary"
              >
                {album.artist}
              </button>
            ) : (
              album.artist
            )}
          </p>
          <p className="num mt-3 text-xs text-ink-faint">
            {album.year && <>{album.year} 年 · </>}
            {album.genre && <>{album.genre} · </>}
            {album.songs.length} 首 · {formatDurationNatural(totalDuration)}
          </p>

          {/* 操作行：文字级主操作 + 细线次操作 + 心形图标键（DESIGN §4.1） */}
          <div className="mt-7 flex items-center gap-6">
            <button
              onClick={() => playAllInOrder(album.songs)}
              className="inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-semibold tracking-[0.1em] text-ink transition-colors duration-200 hover:border-primary hover:text-primary active:scale-[0.97]"
            >
              <Play size={13} weight="fill" />
              播放全部
            </button>
            <button
              onClick={() => playAllShuffled(album.songs)}
              className="inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
            >
              <Shuffle size={14} />
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
                'grid h-9 w-9 place-items-center rounded-full border transition-colors duration-200 active:scale-[0.94]',
                starred
                  ? 'border-primary text-primary'
                  : 'border-hair text-ink-soft hover:border-primary hover:text-primary'
              )}
              aria-label={starred ? '取消收藏专辑' : '收藏专辑'}
            >
              <Heart size={17} weight={starred ? 'fill' : 'regular'} />
            </button>
          </div>
        </div>
      </div>

      {/* 曲目表：SongList 自带 border-t，页面不再包带 border 的容器 */}
      <div className="mt-12">
        <SongList
          songs={album.songs}
          showCover={false}
          showAlbum={false}
          showIndex
        />
      </div>
    </div>
  )
}
