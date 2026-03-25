/**
 * 用户偏好设置 Store
 * 管理封面图服务、歌词服务、音质等个性化配置
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** 封面图来源优先级 */
export type CoverSource = 'server_first' | 'remote_first' | 'remote_only' | 'server_only'

/** 播放详情页封面样式 */
export type CoverShape = 'square' | 'circle'

/** 音频质量 */
export type AudioQuality = 'lossless' | 'high' | 'medium' | 'low'

const QUALITY_LABELS: Record<AudioQuality, string> = {
  lossless: '无损原码（原始格式）',
  high: '高质量（320kbps）',
  medium: '标准（192kbps）',
  low: '省流（128kbps）',
}

const QUALITY_MAX_BITRATE: Record<AudioQuality, number> = {
  lossless: 0,   // 0 = 不转码，使用 download 端点返回原始文件
  high: 320,
  medium: 192,
  low: 128,
}

export { QUALITY_LABELS, QUALITY_MAX_BITRATE }

/** 持久化 key */
const STORAGE_KEY = 'msp-settings-store'

// ─── 初始状态 ─────────────────────────────────────────────────────────────

const initialState = {
  apiPreferServer: true,
  apiAuthToken: '',
  coverRemoteTemplate: '',
  coverSource: 'server_first' as CoverSource,
  coverLoadAlbum: true,
  coverLoadArtist: true,
  coverShape: 'square' as CoverShape,
  o3icsRemoteTemplate: '',
  o3icsConfirmTemplate: '',
  o3icsUseRemote: false,
  o3icsPreferRemote: false,
  o3icsHighlightColor: '#22c55e',
  o3icsFontSize: 20,
  songDetailTemplate: '',
  songDetailPathReplace: '',
  translateTargetLang: '英文',
  translateType: '无',
  audioQuality: 'lossless' as AudioQuality,
}

export type SettingsState = typeof initialState

export type SettingsStore = SettingsState & {
  setApiPreferServer: (v: boolean) => void
  setApiAuthToken: (t: string) => void
  setCoverRemoteTemplate: (t: string) => void
  setCoverSource: (s: CoverSource) => void
  setCoverLoadAlbum: (v: boolean) => void
  setCoverLoadArtist: (v: boolean) => void
  setCoverShape: (s: CoverShape) => void
  setLyricsRemoteTemplate: (t: string) => void
  setLyricsConfirmTemplate: (t: string) => void
  setLyricsUseRemote: (v: boolean) => void
  setLyricsPreferRemote: (v: boolean) => void
  setLyricsHighlightColor: (c: string) => void
  setLyricsFontSize: (size: number) => void
  setSongDetailTemplate: (t: string) => void
  setSongDetailPathReplace: (t: string) => void
  setTranslateTargetLang: (v: string) => void
  setTranslateType: (v: string) => void
  setAudioQuality: (q: AudioQuality) => void
}

// ─── 持久化配置 ────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...initialState,

      setApiPreferServer: (v) => set({ apiPreferServer: v }),
      setApiAuthToken: (t) => set({ apiAuthToken: t }),
      setCoverRemoteTemplate: (t) => set({ coverRemoteTemplate: t }),
      setCoverSource: (s) => set({ coverSource: s }),
      setCoverLoadAlbum: (v) => set({ coverLoadAlbum: v }),
      setCoverLoadArtist: (v) => set({ coverLoadArtist: v }),
      setCoverShape: (s) => set({ coverShape: s }),
      setLyricsRemoteTemplate: (t) => set({ o3icsRemoteTemplate: t }),
      setLyricsConfirmTemplate: (t) => set({ o3icsConfirmTemplate: t }),
      setLyricsUseRemote: (v) => set({ o3icsUseRemote: v }),
      setLyricsPreferRemote: (v) => set({ o3icsPreferRemote: v }),
      setLyricsHighlightColor: (c) => set({ o3icsHighlightColor: c }),
      setLyricsFontSize: (size) => set({ o3icsFontSize: Math.max(14, Math.min(36, size)) }),
      setSongDetailTemplate: (t) => set({ songDetailTemplate: t }),
      setSongDetailPathReplace: (t) => set({ songDetailPathReplace: t }),
      setTranslateTargetLang: (v) => set({ translateTargetLang: v }),
      setTranslateType: (v) => set({ translateType: v }),
      setAudioQuality: (q) => set({ audioQuality: q }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      // 旧格式：zustand persist v1/v2 存为 { state: {...}, version: 0 }
      // 新格式：partialize 直接持久化数据字段，不再嵌套
      migrate: (persistedState: unknown, fromVersion: number): typeof initialState => {
        if (fromVersion === 0 && persistedState && typeof persistedState === 'object' && 'state' in persistedState) {
          const inner = (persistedState as { state: Partial<typeof initialState> }).state
          // 只取 initialState 中声明的字段，其余 zustand 内部属性全部丢弃
          const dataKeys = Object.keys(initialState) as Array<keyof typeof initialState>
          const merged: Partial<typeof initialState> = {}
          for (const key of dataKeys) {
            if (key in inner) {
              ;(merged as Record<string, unknown>)[key] = inner[key]
            }
          }
          return { ...initialState, ...merged }
        }
        return initialState
      },
      // 只持久化数据字段，不持久化内部属性
      partialize: (state) => {
        const { apiPreferServer, apiAuthToken, coverRemoteTemplate, coverSource,
          coverLoadAlbum, coverLoadArtist, coverShape, o3icsRemoteTemplate,
          o3icsConfirmTemplate, o3icsUseRemote, o3icsPreferRemote, o3icsHighlightColor,
          o3icsFontSize, songDetailTemplate, songDetailPathReplace,
          translateTargetLang, translateType, audioQuality } = state
        return {
          apiPreferServer, apiAuthToken, coverRemoteTemplate, coverSource,
          coverLoadAlbum, coverLoadArtist, coverShape, o3icsRemoteTemplate,
          o3icsConfirmTemplate, o3icsUseRemote, o3icsPreferRemote, o3icsHighlightColor,
          o3icsFontSize, songDetailTemplate, songDetailPathReplace,
          translateTargetLang, translateType, audioQuality,
        }
      },
    }
  )
)

/**
 * 根据歌曲信息和模板生成远程封面 URL
 * 支持占位符: {artist} {album} {title} {id}
 */
export function buildRemoteCoverUrl(
  template: string,
  song: { artist?: string; album?: string; title?: string; id?: string }
): string {
  if (!template) return ''
  return template
    .replace('{artist}', encodeURIComponent(song.artist ?? ''))
    .replace('{album}', encodeURIComponent(song.album ?? ''))
    .replace('{title}', encodeURIComponent(song.title ?? ''))
    .replace('{id}', encodeURIComponent(song.id ?? ''))
}

/**
 * 根据模板生成远程歌词 URL
 * 支持占位符: {artist} {title} {album} {id}
 */
export function buildRemoteLyricsUrl(
  template: string,
  song: { artist?: string; title?: string; album?: string; id?: string }
): string {
  if (!template) return ''
  return template
    .replace('{artist}', encodeURIComponent(song.artist ?? ''))
    .replace('{title}', encodeURIComponent(song.title ?? ''))
    .replace('{album}', encodeURIComponent(song.album ?? ''))
    .replace('{id}', encodeURIComponent(song.id ?? ''))
}
