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

interface SettingsState {
  // --- 自定义 API 全局设置 ---
  /** 优先使用音乐服务接口，只有服务无数据时才从自定义 API 获取 */
  apiPreferServer: boolean
  /** 验证信息，传入 Authorization 请求头 */
  apiAuthToken: string

  // --- 封面图设置 ---
  /** 自定义封面图 API 模板，如 https://api.example.com/cover?artist={artist}&album={album} */
  coverRemoteTemplate: string
  /** 封面来源优先级 */
  coverSource: CoverSource
  /** 是否通过封面接口加载专辑封面 */
  coverLoadAlbum: boolean
  /** 是否通过封面接口加载歌手图片 */
  coverLoadArtist: boolean
  /** 播放详情页封面样式：方形或圆形旋转 */
  coverShape: CoverShape

  // --- 歌词设置 ---
  /** 自定义歌词 API 模板，如 https://api.example.com/lyrics?artist={artist}&title={title} */
  lyricsRemoteTemplate: string
  /** 歌词确认接口 URL 模板 */
  lyricsConfirmTemplate: string
  /** 是否启用远程歌词（覆盖/降级 Navidrome 内置歌词）*/
  lyricsUseRemote: boolean
  /** 远程歌词优先还是服务器歌词优先 */
  lyricsPreferRemote: boolean
  /** 歌词高亮颜色（十六进制色影代码，默认绿色）*/
  lyricsHighlightColor: string
  /** 歌词字号大小（范围 14-32，默认 24）*/
  lyricsFontSize: number

  // --- 歌曲详情接口 ---
  /** 歌曲详情跳转 URL 模板 */
  songDetailTemplate: string
  /** 路径替换，格式为 "pattern,replacement" */
  songDetailPathReplace: string

  // --- 翻译接口 ---
  /** 翻译目标语言 */
  translateTargetLang: string
  /** 翻译类型 */
  translateType: string

  // --- 音质设置 ---
  audioQuality: AudioQuality

  // --- Actions ---
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

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      apiPreferServer: true,
      apiAuthToken: '',
      coverRemoteTemplate: '',
      coverSource: 'server_first',
      coverLoadAlbum: true,
      coverLoadArtist: true,
      coverShape: 'square',
      lyricsRemoteTemplate: '',
      lyricsConfirmTemplate: '',
      lyricsUseRemote: false,
      lyricsPreferRemote: false,
      lyricsHighlightColor: '#22c55e',
      lyricsFontSize: 20,
      songDetailTemplate: '',
      songDetailPathReplace: '',
      translateTargetLang: '英文',
      translateType: '无',
      audioQuality: 'low',

      setApiPreferServer: (v) => set({ apiPreferServer: v }),
      setApiAuthToken: (t) => set({ apiAuthToken: t }),
      setCoverRemoteTemplate: (t) => set({ coverRemoteTemplate: t }),
      setCoverSource: (s) => set({ coverSource: s }),
      setCoverLoadAlbum: (v) => set({ coverLoadAlbum: v }),
      setCoverLoadArtist: (v) => set({ coverLoadArtist: v }),
      setCoverShape: (s) => set({ coverShape: s }),
      setLyricsRemoteTemplate: (t) => set({ lyricsRemoteTemplate: t }),
      setLyricsConfirmTemplate: (t) => set({ lyricsConfirmTemplate: t }),
      setLyricsUseRemote: (v) => set({ lyricsUseRemote: v }),
      setLyricsPreferRemote: (v) => set({ lyricsPreferRemote: v }),
      setLyricsHighlightColor: (c) => set({ lyricsHighlightColor: c }),
      setLyricsFontSize: (size) => set({ lyricsFontSize: Math.max(14, Math.min(36, size)) }),
      setSongDetailTemplate: (t) => set({ songDetailTemplate: t }),
      setSongDetailPathReplace: (t) => set({ songDetailPathReplace: t }),
      setTranslateTargetLang: (v) => set({ translateTargetLang: v }),
      setTranslateType: (v) => set({ translateType: v }),
      setAudioQuality: (q) => set({ audioQuality: q }),
    }),
    {
      name: 'msp-settings-store',
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
