/**
 * 浏览器持久化键的唯一来源。
 *
 * 历史上 useLyrics 与 listeningHistory 各自硬编码了 'msp-play-history'，
 * 但写入的结构互不兼容。所有键集中在此声明，避免再次出现同名不同构。
 */

export const STORAGE_KEYS = {
  playHistory: 'msp-play-history',
  playerStore: 'msp-player-store',
  serverStore: 'msp-server-store',
  settingsStore: 'msp-settings-store',
  themeStore: 'msp-theme-store',
  lyricsCache: 'msp-lyrics-cache',
  coverCache: 'msp-cover-cache',
  syncStore: 'msp-sync-store',
} as const

/** 每日推荐结果缓存前缀，实际键形如 `msp-recommendation:{serverId}:{yyyy-mm-dd}:{batch}:{size}` */
export const RECOMMENDATION_CACHE_PREFIX = 'msp-recommendation:'

/** v1 曾把封面按 `msp-cover:{songId}` 单键存储，现已并入 msp-cover-cache */
export const LEGACY_COVER_KEY_PREFIX = 'msp-cover:'

/** 收听历史序列化后的体积上限（字节）。localStorage 全域约 5MB，历史最多占三成。 */
export const HISTORY_BYTE_BUDGET = 1_500_000

/** 歌词缓存条目上限 */
export const LYRICS_CACHE_LIMIT = 300

/** 封面缓存条目上限 */
export const COVER_CACHE_LIMIT = 500

/** 推荐结果缓存保留的最大条数（同一天内多次「换一批」也不会无限增长） */
export const RECOMMENDATION_CACHE_LIMIT = 6

/** 存储压力事件：内存中的可重建缓存应当自行收缩 */
export const STORAGE_PRESSURE_EVENT = 'msp-storage-pressure'
