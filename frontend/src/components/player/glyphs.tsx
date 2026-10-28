/**
 * 播放器里会「变形」的两个图标。
 *
 * 播放⇄暂停：两枚图标叠在一起，切换时一枚缩小淡出、另一枚弹出来——
 *   按下的那一刻就看得到结果，不等音频真的出声。
 * 收藏：点亮时心形弹一下，外面扩开一圈叶绿的环；取消时只是安静地熄灭。
 *   弹和环只在「这一次点亮」时播：一页收藏挂载时不能二十颗心一起蹦。
 *   收藏后是一颗实心，颜色跟随按钮的字色（墨色）——叶绿只给播放、进度和「当前」，
 *   一列收藏的歌不该亮成一排绿。
 * 都只动 transform / opacity；减弱动态效果时退成直接切换（index.css 的全局兜底）。
 */
import { useState } from 'react'
import { Heart, Pause, Play } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export function PlayPauseGlyph({ playing, size = 20, className }: { playing: boolean; size?: number; className?: string }) {
  const swap = 'absolute inset-0 m-auto transition-[transform,opacity] duration-press ease-press'
  return (
    <span className={cn('relative grid place-items-center', className)} style={{ width: size, height: size }} aria-hidden="true">
      <Play
        size={size}
        weight="fill"
        className={cn(swap, playing ? 'scale-50 opacity-0' : 'scale-100 opacity-100')}
      />
      <Pause
        size={size}
        weight="fill"
        className={cn(swap, playing ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}
      />
    </span>
  )
}

export function HeartGlyph({ on, size = 18, className }: { on: boolean; size?: number; className?: string }) {
  // 记住上一次的状态：只有挂载之后真的变成「点亮」，才播一遍弹和环
  const [prev, setPrev] = useState(on)
  const [lit, setLit] = useState(false)
  if (on !== prev) {
    setPrev(on)
    setLit(on)
  }
  return (
    <span className={cn('relative grid place-items-center', className)} style={{ width: size, height: size }} aria-hidden="true">
      {/* key 随状态变：每次点亮都重新播一遍入场 */}
      <Heart
        key={on ? 'on' : 'off'}
        size={size}
        weight={on ? 'fill' : 'regular'}
        className={cn(lit && 'animate-heart-pop motion-reduce:animate-none')}
      />
      {lit && (
        <span
          key="ring"
          className="pointer-events-none absolute inset-[-40%] rounded-full border-2 border-leaf/70 animate-heart-ring motion-reduce:hidden"
        />
      )}
    </span>
  )
}
