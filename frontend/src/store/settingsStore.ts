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

// 状态 + actions 合并后的完整 store 类型（由 TypeScript 从初始值推断）
type SettingsStore = {
  apiPreferServer: boolean
  apiAuthToken: string
  coverRemoteTemplate: string
  coverSource: CoverSource
  coverLoadAlbum: boolean
  coverLoadArtist: boolean
  coverShape: CoverShape
  o3icsRemoteTemplate: string
  o3icsConfirmTemplate: string
  o3icsUseRemote: boolean
  o3icsPreferRemote: boolean
  o3icsHighlightColor: string
  o3icsFontSize: number
  songDetailTemplate: string
  songDetailPathReplace: string
  translateTargetLang: string
  translateType: string
  audioQuality: AudioQuality
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
    { name: 'msp-settings-store' }
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
