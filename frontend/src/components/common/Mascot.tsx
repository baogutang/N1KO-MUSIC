/**
 * 吉祥物：糯米（白兔，黄背带裤）与毛豆（绿青蛙，红白条纹 T 恤）。
 * 角色版权归作者 N1KO（绘本《糯米和毛豆》）。图是 Codex 出的渲染原图，在本机抠成透明底
 * （docs/redesign/v6/mascots/cutout.py；原图、出图提示词也在那个目录）。眨眼帧只含眼睛那几块，叠在原图上用。
 *
 * 只出现在「没有内容可看」的时刻：开屏、登录欢迎、空列表、没有结果、出错——
 * 从不压在内容或操作上面。它是装饰：alt 为空、对读屏隐藏，旁边的文字已经把话说清楚。
 *
 * 动起来的方式都很轻：待机时慢慢呼吸；有眨眼帧的角色每隔几秒眨一下（两张图叠着，闭眼那张只亮 120ms）；
 * 鼠标停上去会歪一下头。减弱动态效果时全部停在静帧。
 */
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export type MascotName =
  | 'duo-wave'
  | 'nuomi-sleep'
  | 'nuomi-wink'
  | 'maodou-listen'
  | 'maodou-surprised'
  | 'maodou-wave'

/** 有眨眼帧的姿势 */
const BLINK: Partial<Record<MascotName, string>> = {
  'duo-wave': 'duo-wave-blink',
  'maodou-wave': 'maodou-wave-blink',
}

export function Mascot({
  name,
  size = 160,
  priority = false,
  className,
}: {
  name: MascotName
  /** 显示宽度（px）；高度按图片比例 */
  size?: number
  /** 首屏最大的那张图（登录页）：立即加载、提高优先级 */
  priority?: boolean
  className?: string
}) {
  const blink = BLINK[name]
  return (
    <span
      aria-hidden="true"
      // 默认宽度走 CSS 变量：调用方传 w-* 类就能覆盖（twMerge 让后来的赢），不会被内联样式压住
      className={cn('group/mascot relative inline-block w-[var(--mascot-w)] select-none', className)}
      style={{ '--mascot-w': `${size}px` } as CSSProperties}
    >
      <span className="block origin-bottom animate-breathe transition-transform duration-5 ease-press motion-reduce:animate-none [@media(hover:hover)]:group-hover/mascot:-rotate-3">
        <img
          src={`/mascots/${name}.webp`}
          alt=""
          draggable={false}
          loading={priority ? 'eager' : 'lazy'}
          // React 18 还不认驼峰的 fetchPriority，直接写原生的小写属性
          {...{ fetchpriority: priority ? 'high' : 'auto' }}
          decoding="async"
          className="block h-auto w-full"
        />
        {blink && (
          <img
            src={`/mascots/${blink}.webp`}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 block h-auto w-full animate-mascot-blink opacity-0 motion-reduce:hidden"
          />
        )}
      </span>
    </span>
  )
}
