/**
 * 服务端已经算好的专辑书架。
 *
 * getAlbumList2 有十种排序维度，此前只用了 newest 与 alphabeticalByName 两种，
 * frequent / recent / highest / starred 全都白放着。
 *
 * 渲染成一排横向的封面书架：封面是页面上唯一的大面积色块，
 * 标题、歌手、次数/年份退到图注里。
 *
 * 同文件导出：
 *   AlbumCoverCard  首页「最近添加」用同一张卡，键盘语义（外层 Enter/Space 进详情、
 *                   内层播放键自管）由 CoverCard 统一提供。
 *   CoverStack      叠卡：一组东西（继续听、今日推荐）用最多三张封面叠成一副牌，
 *                   悬停或键盘聚焦时后两张向两侧扇开。放在这里而不是 ContinueShelf，
 *                   是因为后者会把音频引擎拖进只想要一副牌的页面。
 *   SongCover       叠卡里的一张牌面：按歌曲取封面。
 */

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { TargetAndTransition, Variants } from 'motion/react'
import { Play } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { findAdapterFor } from '@/api'
import { CoverCard, CoverShelf } from '@/components/common/CoverCard'
import { CoverImage } from '@/components/common/CoverImage'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { useAlbumShelf, type AlbumShelfType } from '@/hooks/useServerQueries'
import { SPRING_SNAPPY } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { playAlbum } from '@/utils/playActions'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import { detailPath } from '@/utils/detailPath'
import type { Album, Song } from '@/api/types'

/**
 * 书架上的专辑卡：封面 + 标题 + 歌手，右下角悬浮播放键。
 * details 是图注第三行的若干条独立信息（曲目数、年份、播放次数），各占一个 span。
 */
export function AlbumCoverCard({ album, details = [] }: { album: Album; details?: string[] }) {
  const { t } = useT()
  const navigate = useNavigate()
  const coverUrl = album.coverArt
    ? (findAdapterFor(album.serverId)?.getCoverUrl(album.coverArt, 300) ?? undefined)
    : undefined

  return (
    <CoverCard
      aria-label={album.name}
      onClick={() => navigate(detailPath('albums', album.id, album.serverId))}
      tile={
        <ImageWithFallback
          src={coverUrl}
          alt={album.name}
          fallbackType="album"
          className="h-full w-full object-cover"
          customCoverParams={{ type: 'album', artist: album.artist, album: album.name }}
        />
      }
      overlay={
        /* 触屏常显；有 hover 的设备上悬停才浮现，键盘聚焦也会浮现 */
        <button
          type="button"
          onClick={e => {
            e.stopPropagation()
            void playAlbum(album)
          }}
          aria-label={t('album.playLabel', { name: album.name })}
          className="press-pop glass absolute bottom-2.5 right-2.5 grid h-11 w-11 place-items-center rounded-pill text-ink focus-visible:opacity-100 [@media(hover:hover)]:h-9 [@media(hover:hover)]:w-9 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:hover:bg-lime [@media(hover:hover)]:hover:text-lime-ink [@media(hover:hover)]:group-hover:opacity-100"
        >
          <Play size={16} weight="fill" />
        </button>
      }
      title={spaceCJK(album.name)}
      meta={spaceCJK(album.artist)}
      captionExtra={
        details.length > 0 ? (
          <p className="num mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-3">
            {details.map(detail => <span key={detail}>{detail}</span>)}
          </p>
        ) : undefined
      }
    />
  )
}

export function AlbumShelf({
  type,
  label,
  limit = 6,
}: {
  type: AlbumShelfType
  label: string
  limit?: number
}) {
  const { t } = useT()
  const { data, isLoading } = useAlbumShelf(type, limit)
  const albums = data?.items ?? []

  // 服务器没有这个维度的数据（或不支持）时整块不渲染，而不是留一个空标题
  if (isLoading || !albums.length) return null

  return (
    <section aria-labelledby={`shelf-${type}`}>
      <div className="section-head">
        <h2 id={`shelf-${type}`}>{label}</h2>
      </div>
      <CoverShelf>
        {albums.map(album => (
          <AlbumCoverCard
            key={album.id}
            album={album}
            details={
              album.playCount
                ? [t('album.playCount', { count: album.playCount })]
                : album.year
                  ? [String(album.year)]
                  : []
            }
          />
        ))}
      </CoverShelf>
    </section>
  )
}

/* ===================================================
   叠卡
   =================================================== */

/**
 * 三个深度的姿态，深度 0 是最上面那张。transform-origin 在底边中点：
 * 后两张缩小后顶边落在 -6.5% 与 -12%，从最上面那张的头顶露出一条边，
 * 底边藏在它后面。位移按卡自己的宽高算百分比，所以任何尺寸下比例不变。
 * 后面的牌微暗（透明度），让它们退到房间里。
 */
const DECK_REST: TargetAndTransition[] = [
  { x: '0%', y: '0%', scale: 1, rotate: 0, opacity: 1 },
  { x: '0%', y: '-14.5%', scale: 0.92, rotate: 0, opacity: 0.8 },
  { x: '0%', y: '-28%', scale: 0.84, rotate: 0, opacity: 0.58 },
]

/**
 * 悬停 / 键盘聚焦：后两张向左右扇开并各转 6 度，顶上那张不动。
 * 扇开的宽度有上限：左边不能超过内容区的左内边距（超出的部分会被滚动容器裁掉），
 * 右边要留给旁边的文字列（调用方的列间距，见下面 CoverStack 的说明）。
 */
const DECK_FAN: TargetAndTransition[] = [
  { x: '0%', y: '0%', scale: 1, rotate: 0, opacity: 1 },
  { x: '-10%', y: '-8%', scale: 0.92, rotate: -6, opacity: 0.96 },
  { x: '12%', y: '-8%', scale: 0.92, rotate: 6, opacity: 0.96 },
]

const DECK_VARIANTS: Variants = {
  rest: (depth: number) => DECK_REST[depth],
  fan: (depth: number) => DECK_FAN[depth],
}

/**
 * 叠卡：一整副牌是一个按钮。
 *
 * 用在「一组东西」的封面上：继续听（几条断点）、今日推荐（一条混合歌单）。
 * 牌面由调用方给（最多三张，第一张在最上面），尺寸由 className 给宽度，
 * 高度是它的正方形再加上顶上留给露边的 12%。扇开时右边那张会探出去约 14% 的宽度，
 * 旁边的文字列要留出这么多间距（200px 宽留 48px，160px 宽留 40px）。
 * 系统要求减弱动态效果时不扇开，牌堆保持静止。
 */
export function CoverStack({
  covers,
  onClick,
  'aria-label': ariaLabel,
  className,
}: {
  covers: ReactNode[]
  onClick: () => void
  'aria-label': string
  className?: string
}) {
  const reduce = useReducedMotion()
  const cards = covers.slice(0, 3)
  /* 顶上留给后面的牌露出来的边：三张留 12%，两张留 6.5%，一张不留（就是一张封面） */
  const peek = cards.length >= 3 ? 'pt-[12%]' : cards.length === 2 ? 'pt-[6.5%]' : undefined
  return (
    /* 外层只管宽度（className）；里层 padding 的百分比按「包含块的宽度」算，
       所以必须套一层：对着这一层的宽度，12% 才恰好是方封面高度的 12% */
    <div className={className}>
      <div className={peek}>
        <motion.button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          initial={false}
          animate="rest"
          whileHover={reduce ? undefined : 'fan'}
          whileFocus={reduce ? undefined : 'fan'}
          className="press-pop relative block aspect-square w-full rounded-cover"
        >
          {cards.map((node, depth) => (
            <motion.span
              key={depth}
              custom={depth}
              variants={DECK_VARIANTS}
              transition={SPRING_SNAPPY}
              style={{ zIndex: cards.length - depth, transformOrigin: '50% 100%' }}
              className={cn('cover-frame absolute inset-0 block', depth === 0 ? 'shadow-md' : 'shadow-sm')}
            >
              {node}
            </motion.span>
          ))}
        </motion.button>
      </div>
    </div>
  )
}

/** 叠卡里的一张牌面：按歌曲取封面（插件源、自定义封面、手动钉住的封面都经 useCoverUrl / CoverImage） */
export function SongCover({ song, size = 400 }: { song: Song; size?: number }) {
  const { primary, fallback } = useCoverUrl(song, { size })
  return (
    <CoverImage
      primary={primary}
      fallback={fallback}
      alt=""
      className="h-full w-full"
      songId={song.id}
      customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
    />
  )
}
