/**
 * 房间的光：铺在外壳最底下的一层，颜色来自正在播放的封面（services/artLight）。
 *
 * 渐变不能插值，所以换歌时不是「改颜色」，而是叠一层新的、淡入，再拿掉旧的——
 * 只动 opacity，合成线程就能做完，不触发整棵树的样式重算。
 * 每层在自己身上重新声明 --wash / --wash-2：引用型 token 在 :root 上就解析掉了，
 * 子元素只改 --art-h 不会让继承下来的 --wash 跟着变（index.css 的 .art-wash 已写好）。
 */
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { useArtLightStore } from '@/store/artLightStore'
import type { ArtPalette } from '@/services/artLight'

interface Layer {
  id: number
  palette: ArtPalette
}

const vars = (p: ArtPalette) =>
  ({ '--art-h': p.h, '--art-c': p.c, '--art-h2': p.h2, '--art-c2': p.c2 }) as CSSProperties

export function ArtWash({ className, palette: fixed }: { className?: string; palette?: ArtPalette }) {
  const live = useArtLightStore(s => s.palette)
  const palette = fixed ?? live
  const nextId = useRef(1)
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, palette }])

  useEffect(() => {
    setLayers(prev => {
      if (prev[prev.length - 1].palette === palette) return prev
      return [...prev.slice(-1), { id: nextId.current++, palette }]
    })
  }, [palette])

  return (
    <div aria-hidden="true" className={cn('pointer-events-none overflow-hidden', className)}>
      {layers.map((layer, i) => (
        <div
          key={layer.id}
          className={cn('art-wash absolute inset-0', i > 0 && 'animate-wash-in motion-reduce:animate-none')}
          style={vars(layer.palette)}
          onAnimationEnd={() => setLayers(prev => (prev.length > 1 ? prev.slice(-1) : prev))}
        />
      ))}
    </div>
  )
}
