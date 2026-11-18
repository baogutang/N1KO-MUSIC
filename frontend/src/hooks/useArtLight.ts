/**
 * 让房间随歌变色：跟着当前曲目取封面的调色板，写进根元素的 --art-*。
 * 只在外壳里挂一次（MainLayout）。取色用 64px 的缩略图，排在空闲时段。
 *
 * 取的是「屏幕上那张封面」：它可能是手动钉住的图、服务器的图、第三方接口搜来的图
 * （顺序跟 CoverImage 用的 pickMergedCoverDisplaySrc 一致）。按这个顺序挨个试，
 * 用第一张读得出像素的——此前只拿服务器地址去取，封面其实来自别处、或者服务器不给
 * CORS 头时一律退回场灯，表现就是每首歌底色都是同一个绿。
 */
import { useEffect, useMemo } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCoverUrl, usePinnedCover } from '@/hooks/useCoverUrl'
import { useCustomCoverUrl } from '@/hooks/useServerQueries'
import { useArtLightStore } from '@/store/artLightStore'
import { HOUSE_LIGHTS, applyPalette, getPaletteOf, peekPaletteOf } from '@/services/artLight'

export function useArtLight() {
  const currentSong = usePlayerStore(s => s.currentSong)
  const { primary, fallback } = useCoverUrl(currentSong ?? undefined, { size: 64 })
  const pinned = usePinnedCover(currentSong?.id, currentSong?.serverId)
  const coverSource = useSettingsStore(s => s.coverSource)
  const hasRemote = useSettingsStore(s => !!s.coverRemoteTemplate)

  // 与播放页大封面传给 CoverImage 的参数逐项相同：两边共用同一条查询，不会多请求一次
  const title = currentSong?.title
  const artist = currentSong?.artist
  const album = currentSong?.album
  const path = currentSong?.path
  const hasSong = !!currentSong
  const customParams = useMemo(
    () => (hasSong && hasRemote ? { type: 'song' as const, title, artist, album, path } : null),
    [hasSong, hasRemote, title, artist, album, path],
  )
  const { data: custom } = useCustomCoverUrl(customParams)

  // 候选地址拼成一个字符串当依赖：数组每次渲染都是新的，内容没变就不该重取
  const remoteFirst = coverSource === 'remote_first' || coverSource === 'remote_only'
  const key = [pinned, remoteFirst ? custom : null, primary, fallback, remoteFirst ? null : custom]
    .filter((u): u is string => !!u)
    .filter((u, i, all) => all.indexOf(u) === i)
    .join('\n')

  useEffect(() => {
    const { setPalette } = useArtLightStore.getState()
    const urls = key ? key.split('\n') : []
    if (!urls.length) {
      applyPalette(HOUSE_LIGHTS)
      setPalette(HOUSE_LIGHTS, null)
      return
    }
    // 算过的封面同步上色：切回一首听过的歌，房间立刻就是它的颜色
    const cached = peekPaletteOf(urls)
    if (cached) {
      applyPalette(cached.palette)
      setPalette(cached.palette, cached.url)
      return
    }
    let cancelled = false
    const run = () => {
      void getPaletteOf(urls).then(({ palette, url }) => {
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
  }, [key])
}
