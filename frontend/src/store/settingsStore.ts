/**
 * 用户偏好设置 Store
 * 管理封面图服务、歌词服务、音质等个性化配置
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createPersistStorage } from '@/store/persistStorage'
import { STORAGE_KEYS } from '@/services/storageKeys'
import { PREAMP_MAX_DB, PREAMP_MIN_DB, type ReplayGainMode } from '@/utils/replayGain'
import { t } from '@/i18n'

/** 封面图来源优先级 */
export type CoverSource = 'server_first' | 'remote_first' | 'remote_only' | 'server_only'

/** 播放详情页封面样式 */
export type CoverShape = 'square' | 'circle'

/** 音频质量 */
export type AudioQuality = 'lossless' | 'high' | 'medium' | 'low'

/**
 * 音质档位的文案 key（不是文案本身）。
 * 模块级常量在求值那一刻就定型，直接放翻译好的字符串会把语言钉死在首次加载时。
 */
const QUALITY_LABEL_KEYS: Record<AudioQuality, string> = {
  lossless: 'audio.quality.lossless',
  high: 'audio.quality.high',
  medium: 'audio.quality.medium',
  low: 'audio.quality.low',
}

const QUALITY_MAX_BITRATE: Record<AudioQuality, number> = {
  lossless: 0,   // 0 = 不转码，使用 download 端点返回原始文件
  high: 320,
  medium: 192,
  low: 128,
}

export { QUALITY_LABEL_KEYS, QUALITY_MAX_BITRATE }

/**
 * 系统通知栏 / 锁屏上那两个可配的按键。
 * 'track' 上一首下一首，'seek' 快退快进，'both' 两组都放（系统按容量取舍）。
 */
export type NotificationActions = 'track' | 'seek' | 'both'

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
  /** 局域网 / Wi-Fi 下的音质（历史字段，继续作为默认档）*/
  audioQuality: AudioQuality
  /**
   * 蜂窝网络下的音质。
   * 默认无损意味着出门在外仍在从家里的上行拉原始 FLAC，既费流量又容易卡。
   */
  cellularAudioQuality: AudioQuality
  /** 按网络类型自动切换音质 */
  adaptiveQuality: boolean

  // --- 音量归一化 ---
  replayGainMode: ReplayGainMode
  /** 前置增益（dB），-15 ~ +15 */
  replayGainPreamp: number

  // --- 播放 ---
  /** 倍速播放，0.5 ~ 3。有声书 / 讲座 / 广播剧用 */
  playbackRate: number
  /** 暂停与切歌时做音量斜坡，而不是硬切 */
  smoothTransitions: boolean
  /** 全屏播放器在手机上默认展示封面还是歌词。偏爱歌词的人不该每次都重点一遍。 */
  playerMobileView: 'cover' | 'lyrics'
  setPlayerMobileView: (view: 'cover' | 'lyrics') => void
  /** 预加载下一首以逼近无缝（弱无缝，非真正 gapless）*/
  preloadNext: boolean
  /** 队列播完自动续接相似曲目，而不是直接停 */
  autoContinueQueue: boolean
  /**
   * 系统通知 / 锁屏上放哪两个按键。
   *
   * 听歌的人要上一首下一首；听有声书和播客的人要快退快进——
   * 同一块面板服务不了两种需求，所以让用户自己选。
   */
  notificationActions: NotificationActions
  /** 快退快进的步长（秒）*/
  seekStepSeconds: number
  /** 耳机断开导致暂停后，重新插回时自动接着放 */
  resumeAfterInterruption: boolean
  /**
   * 从 MusicBrainz 补歌手档案。
   *
   * 默认关闭：发请求等于把「你在看哪位歌手」告诉第三方，
   * 而自托管本来就是为了不让任何人知道你在听什么。要开由用户自己开。
   */
  musicBrainzEnabled: boolean

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
  setCellularAudioQuality: (q: AudioQuality) => void
  setAdaptiveQuality: (v: boolean) => void
  setReplayGainMode: (m: ReplayGainMode) => void
  setReplayGainPreamp: (db: number) => void
  setPlaybackRate: (rate: number) => void
  setSmoothTransitions: (v: boolean) => void
  setPreloadNext: (v: boolean) => void
  setAutoContinueQueue: (v: boolean) => void
  setNotificationActions: (v: NotificationActions) => void
  setSeekStepSeconds: (v: number) => void
  setResumeAfterInterruption: (v: boolean) => void
  setMusicBrainzEnabled: (v: boolean) => void
  /** 多源播放优先序（serverId 数组，前者优先）。空数组 = 自动：NAS 优先、主库在前 */
  playbackPriority: string[]
  setPlaybackPriority: (ids: string[]) => void
  /** 删除音源时同步摘掉死 id（设置页调排序只写已连接源，死 id 残留会被静默丢弃） */
  prunePlaybackPriority: (removedIds: string[]) => void
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
      lyricsHighlightColor: '#2ec27e',
      lyricsFontSize: 20,
      songDetailTemplate: '',
      songDetailPathReplace: '',
      translateTargetLang: '英文',
      translateType: '无',
      audioQuality: 'lossless',
      cellularAudioQuality: 'medium',
      adaptiveQuality: true,
      replayGainMode: 'auto',
      replayGainPreamp: 0,
      playbackRate: 1,
      smoothTransitions: true,
      playerMobileView: 'cover' as const,
      setPlayerMobileView: (view: 'cover' | 'lyrics') => set({ playerMobileView: view }),
      preloadNext: true,
      autoContinueQueue: true,
      notificationActions: 'track',
      seekStepSeconds: 15,
      resumeAfterInterruption: true,
      musicBrainzEnabled: false,
      playbackPriority: [],
      setPlaybackPriority: (ids) => set({ playbackPriority: ids }),
      prunePlaybackPriority: (removedIds) => set(state => ({
        playbackPriority: state.playbackPriority.filter(id => !removedIds.includes(id)),
      })),

      // 全局来源优先级同时驱动封面和歌词，避免设置项只被持久化却不产生任何效果。
      // 用户仍可在下方用更细粒度的开关覆盖歌词策略。
      setApiPreferServer: (v) => set({
        apiPreferServer: v,
        coverSource: v ? 'server_first' : 'remote_first',
        lyricsPreferRemote: !v,
      }),
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
      setCellularAudioQuality: (q) => set({ cellularAudioQuality: q }),
      setAdaptiveQuality: (v) => set({ adaptiveQuality: v }),
      setReplayGainMode: (m) => set({ replayGainMode: m }),
      setReplayGainPreamp: (db) =>
        set({ replayGainPreamp: Math.max(PREAMP_MIN_DB, Math.min(PREAMP_MAX_DB, db)) }),
      setPlaybackRate: (rate) => set({ playbackRate: Math.max(0.5, Math.min(3, rate)) }),
      setSmoothTransitions: (v) => set({ smoothTransitions: v }),
      setPreloadNext: (v) => set({ preloadNext: v }),
      setAutoContinueQueue: (v) => set({ autoContinueQueue: v }),
      setNotificationActions: (v) => set({ notificationActions: v }),
      setSeekStepSeconds: (v) => set({ seekStepSeconds: Math.min(120, Math.max(5, Math.round(v))) }),
      setResumeAfterInterruption: (v) => set({ resumeAfterInterruption: v }),
      setMusicBrainzEnabled: (v) => set({ musicBrainzEnabled: v }),
    }),
    {
      name: STORAGE_KEYS.settingsStore,
      // 体积小、纯用户主动变更，同步写入避免丢配置
      storage: createPersistStorage({ debounceMs: 0 }),
      version: 2,
      // v0 -> v1：会员体系移除。旧版免费用户被强制锁定在 low（非主动选择），
      // 迁移为无损默认；之后用户在设置里的选择正常持久化
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>
        if (version === 0 && state?.audioQuality === 'low') {
          state.audioQuality = 'lossless'
        }
        // v1 -> v2：音质拆成 Wi-Fi / 蜂窝两档。旧的单一设置作为 Wi-Fi 档，
        // 蜂窝档给一个保守默认，不要沿用无损。
        if (version < 2) {
          if (state.cellularAudioQuality === undefined) state.cellularAudioQuality = 'medium'
          if (state.adaptiveQuality === undefined) state.adaptiveQuality = true
          if (state.replayGainMode === undefined) state.replayGainMode = 'auto'
          if (state.replayGainPreamp === undefined) state.replayGainPreamp = 0
          if (state.playbackRate === undefined) state.playbackRate = 1
          if (state.smoothTransitions === undefined) state.smoothTransitions = true
          if (state.preloadNext === undefined) state.preloadNext = true
          if (state.autoContinueQueue === undefined) state.autoContinueQueue = true
          if (state.notificationActions === undefined) state.notificationActions = 'track'
          if (state.seekStepSeconds === undefined) state.seekStepSeconds = 15
          if (state.resumeAfterInterruption === undefined) state.resumeAfterInterruption = true
          if (state.musicBrainzEnabled === undefined) state.musicBrainzEnabled = false
        }
        return state
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
