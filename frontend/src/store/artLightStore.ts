/**
 * 当前「房间的光」：正在播放那首歌的封面调色板。
 * useArtLight（外壳里挂一次）负责算和写；舞台、光场、迷你条只读。
 */
import { create } from 'zustand'
import { HOUSE_LIGHTS, type ArtPalette } from '@/services/artLight'

interface ArtLightState {
  palette: ArtPalette
  /** 调色板对应的封面地址（换歌时用来判断光场要不要重新扩散） */
  source: string | null
  setPalette: (palette: ArtPalette, source: string | null) => void
}

export const useArtLightStore = create<ArtLightState>(set => ({
  palette: HOUSE_LIGHTS,
  source: null,
  setPalette: (palette, source) => set({ palette, source }),
}))
