/**
 * 让房间随歌变色：跟着当前曲目取封面的调色板，写进根元素的 --art-*。
 * 只在外壳里挂一次（MainLayout）。取色用 64px 的缩略图，排在空闲时段。
 */
import { useEffect } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { useArtLightStore } from '@/store/artLightStore'
import { HOUSE_LIGHTS, applyPalette, getPalette, peekPalette } from '@/services/artLight'

export function useArtLight() {
  const currentSong = usePlayerStore(s => s.currentSong)
  const { primary, fallback } = useCoverUrl(currentSong ?? undefined, { size: 64 })
  const url = primary ?? fallback

  useEffect(() => {
    const { setPalette } = useArtLightStore.getState()
    if (!url) {
      applyPalette(HOUSE_LIGHTS)
      setPalette(HOUSE_LIGHTS, null)
      return
    }
    // 算过的封面同步上色：切回一首听过的歌，房间立刻就是它的颜色
    const cached = peekPalette(url)
    if (cached) {
      applyPalette(cached)
      setPalette(cached, url)
      return
    }
    let cancelled = false
    const run = () => {
      void getPalette(url).then(palette => {
        if (cancelled) return
        applyPalette(palette)
        setPalette(palette, url)
      })
    }
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    const cancelIdle = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
    if (idle && cancelIdle) {
      const handle = idle(run, { timeout: 400 })
      return () => {
        cancelled = true
        cancelIdle(handle)
      }
    }
    const timer = setTimeout(run, 60)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [url])
}
