/**
 * 本地歌词缓存 Store
 *
 * 实际实现位于 o3icCacheStore.ts（历史文件名，勿重复实现）。
 * 此处仅做转发：两份实现会共用同一个 persist key（msp-lyrics-cache），
 * 若各自实例化会互相覆盖存储。
 */

export { useLyricCacheStore } from '@/store/o3icCacheStore'
