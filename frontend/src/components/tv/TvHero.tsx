/**
 * 电视首页的头条（替代手机 / 电脑上的大标题 + 精选专辑）。
 *
 * 在放歌时：大封面 + 歌名 + 进度，三个键「继续播放 / 暂停」「打开播放页」「随便听听」；
 * 还没放歌时换成本期专辑：「播放整张专辑」「查看专辑」「随便听听」。
 * 第一个键带 data-tv-autofocus：一打开 App 焦点就在它上面，按确认就开始听。
 */

import { memo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, Pause, MusicNotes, Shuffle, VinylRecord } from '@phosphor-icons/react'
import type { Album } from '@/api/types'
import { usePlayerStore } from '@/store/playerStore'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { CoverImage } from '@/components/common/CoverImage'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/utils/formatters'
import { spaceCJK } from '@/utils/cjkTypography'
import { shuffleWholeLibrary, playAlbum } from '@/utils/playActions'
import { detailPath } from '@/utils/detailPath'
import { notePauseReason } from '@/lib/playbackTrail'
import { useT } from '@/i18n'

const heroBtn = 'h-10 px-5 text-[14px] [&_svg]:h-[17px] [&_svg]:w-[17px]'

/** 进度单独订阅 currentTime：播放中只有这一小块重渲染 */
const HeroProgress = memo(function HeroProgress() {
  const currentTime = usePlayerStore(s => s.currentTime)
  const duration = usePlayerStore(s => s.duration)
  const ratio = duration > 0 ? Math.min(1, currentTime / duration) : 0
  return (
    <div className="mt-1 flex items-center gap-2.5 text-[11.5px] font-medium text-ink-3">
      <span className="num">{formatDuration(currentTime)}</span>
      <span className="relative h-[3px] w-[210px] overflow-hidden rounded-pill bg-ink/[0.14]">
        <span className="absolute inset-0 origin-left bg-leaf" style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span className="num">{formatDuration(duration)}</span>
    </div>
  )
})

function HeroFrame({ cover, title, sub, children }: { cover: ReactNode; title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <section className="flex items-end gap-7 pt-1">
      <div className="cover-frame h-[200px] w-[200px] flex-none shadow-cover">{cover}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-0.5">
        <h1 className="truncate font-display text-[38px] font-bold leading-[1.04] tracking-[-0.03em] text-ink">{spaceCJK(title)}</h1>
        {sub}
        <div className="mt-3.5 flex gap-3">{children}</div>
      </div>
    </section>
  )
}

export function TvHero({ album, albumCoverUrl, albumMeta }: { album?: Album; albumCoverUrl?: string; albumMeta: string[] }) {
  const { t } = useT()
  const navigate = useNavigate()
  const song = usePlayerStore(s => s.currentSong)
  const isPlaying = usePlayerStore(s => s.isPlaying)
  const togglePlay = usePlayerStore(s => s.togglePlay)
  const setFullscreen = usePlayerStore(s => s.setFullscreen)
  const { primary, fallback } = useCoverUrl(song ?? undefined, { size: 480 })

  const shuffle = (
    <Button variant="secondary" className={heroBtn} onClick={() => void shuffleWholeLibrary()}>
      <Shuffle weight="bold" />
      {t('home.shuffleAll')}
    </Button>
  )

  if (song) {
    return (
      <HeroFrame
        cover={<CoverImage primary={primary} fallback={fallback} alt="" className="h-full w-full" eager songId={song.id} />}
        title={song.title}
        sub={
          <>
            <p className="truncate text-[15px] font-medium text-ink-2">
              {spaceCJK(song.artist)}{song.album ? ` · ${spaceCJK(song.album)}` : ''}
            </p>
            <HeroProgress />
          </>
        }
      >
        <Button
          className={heroBtn}
          data-tv-autofocus=""
          onClick={() => { notePauseReason('ui', 'tv home'); togglePlay() }}
        >
          {isPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
          {isPlaying ? t('player.pause') : t('tv.resume')}
        </Button>
        <Button variant="secondary" className={heroBtn} onClick={() => setFullscreen(true)}>
          <MusicNotes weight="bold" />
          {t('tv.openPlayer')}
        </Button>
        {shuffle}
      </HeroFrame>
    )
  }

  if (album) {
    return (
      <HeroFrame
        cover={
          <ImageWithFallback
            src={albumCoverUrl}
            alt={album.name}
            fallbackType="album"
            className="h-full w-full object-cover"
            customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
          />
        }
        title={album.name}
        sub={
          <>
            <p className="truncate text-[15px] font-semibold text-leaf">{spaceCJK(album.artist)}</p>
            <p className="num flex gap-x-3 text-[12.5px] font-medium text-ink-3">
              <span>{t('tv.featured')}</span>
              {albumMeta.map((item, i) => <span key={`${i}:${item}`}>{item}</span>)}
            </p>
          </>
        }
      >
        <Button className={heroBtn} data-tv-autofocus="" onClick={() => void playAlbum(album)}>
          <Play weight="fill" />
          {t('home.playWholeAlbum')}
        </Button>
        <Button variant="secondary" className={heroBtn} onClick={() => navigate(detailPath('albums', album.id, album.serverId))}>
          <VinylRecord weight="bold" />
          {t('tv.viewAlbum')}
        </Button>
        {shuffle}
      </HeroFrame>
    )
  }

  // 曲库还没加载出来：只给一个随便听听，焦点照样有地方落
  return (
    <section className="flex items-end gap-7 pt-1">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <h1 className="font-display text-[38px] font-bold leading-[1.04] tracking-[-0.03em] text-ink">{t('nav.home')}</h1>
        <div className="flex gap-3">
          <Button className={heroBtn} data-tv-autofocus="" onClick={() => void shuffleWholeLibrary()}>
            <Shuffle weight="bold" />
            {t('home.shuffleAll')}
          </Button>
        </div>
      </div>
    </section>
  )
}
