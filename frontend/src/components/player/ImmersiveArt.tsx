/**
 * 沉浸样式的大封面（设置「播放详情页封面样式 › 沉浸」）：封面不是一张卡片，而是画面本身。
 *
 *   side  横屏：贴着左边、高度等于整屏，右缘和下缘渐隐进色场
 *   top   竖屏：顶满屏幕宽、贴到最上面，下缘渐隐；看歌词 / 接下来时退成一层淡淡的底（dim）
 *
 * 遮罩、退淡写在 index.css 的 .immersive-art 上，所以新旧两张封面共用一个渐隐。
 * 换歌两层交叉淡化，新的那张从大一点慢慢缩回来。只动 opacity / transform。
 * 所有来源都加载失败时报 onFailed：正在播放页退回方形封面。
 */
import { useCallback } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Song } from '@/api/types'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { CoverImage } from '@/components/common/CoverImage'

/** 横屏整屏高、iPad 是 2 倍屏：640 的图拉开会发虚 */
const ART_SIZE = 1200

export const artKey = (s: Song) => `${s.serverId}:${s.id}`

export function ImmersiveArt({
  song,
  placement,
  dim = false,
  onFailed,
}: {
  song: Song
  placement: 'side' | 'top'
  dim?: boolean
  onFailed: (key: string) => void
}) {
  const reduce = useReducedMotion()
  const key = artKey(song)
  return (
    <div className="immersive-art absolute inset-0" data-placement={placement} data-dim={dim ? '' : undefined}>
      <AnimatePresence initial={false}>
        <motion.div
          key={key}
          className="absolute inset-0 origin-[30%_40%]"
          initial={reduce ? false : { opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            opacity: { duration: reduce ? 0 : 0.8, ease: 'easeOut' },
            scale: { duration: 1.4, ease: [0.2, 0.7, 0.2, 1] },
          }}
        >
          <ArtLayer song={song} artId={key} onFailed={onFailed} />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function ArtLayer({ song, artId, onFailed }: { song: Song; artId: string; onFailed: (key: string) => void }) {
  const { primary, fallback } = useCoverUrl(song, { size: ART_SIZE })
  const handleExhausted = useCallback(() => onFailed(artId), [onFailed, artId])
  return (
    <CoverImage
      primary={primary}
      fallback={fallback}
      alt=""
      className="h-full w-full [&_img]:pointer-events-none"
      eager
      bare
      songId={song.id}
      songServerId={song.serverId}
      customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
      onExhausted={handleExhausted}
    />
  )
}
