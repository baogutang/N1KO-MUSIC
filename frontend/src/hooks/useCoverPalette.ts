/**
 * 任意一张封面的调色板（专辑页、歌单页、歌手页的头部光场用）。
 * 与「房间的光」共用同一份缓存：算过的封面同步拿到，首帧就有颜色。
 */
import { useEffect, useState } from 'react'
import { getPalette, peekPalette, type ArtPalette } from '@/services/artLight'

export function useCoverPalette(url: string | undefined): ArtPalette | undefined {
  const [palette, setPalette] = useState<ArtPalette | undefined>(() => peekPalette(url))
  useEffect(() => {
    if (!url) {
      setPalette(undefined)
      return
    }
    const cached = peekPalette(url)
    if (cached) {
      setPalette(cached)
      return
    }
    let alive = true
    void getPalette(url).then(p => {
      if (alive) setPalette(p)
    })
    return () => {
      alive = false
    }
  }, [url])
  return palette
}
