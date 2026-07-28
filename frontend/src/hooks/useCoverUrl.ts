/**
 * useCoverUrl - 统一封面图 URL 解析
 *
 * 优先级：本地缓存（用户手动搜索保存的） > 用户配置的封面来源 > 服务器封面
 */

import { useMemo } from 'react'
import { useSettingsStore, buildRemoteCoverUrl, type CoverSource } from '@/store/settingsStore'
import { getAdapter, hasAdapter } from '@/api'
import { useCoverCacheStore } from '@/store/coverCacheStore'

interface CoverTarget {
  coverArt?: string
  artist?: string
  album?: string
  title?: string
  id?: string
  path?: string
}

interface UseCoverUrlOptions {
  /** 图片尺寸（服务器端封面使用）*/
  size?: number
}

export interface MergedCoverSources {
  coverSource: CoverSource
  serverSrc: string | undefined
  serverFailed: boolean
  customBlobUrl: string | null | undefined
  hasCustom: boolean
  /**
   * 用户在歌曲详情页手动钉住的本地封面，优先级高于一切来源。
   * 这是显式的人工选择，不应被「封面来源」设置覆盖。
   */
  pinnedSrc?: string | null
}

/**
 * 服务器封面 URL 与自定义封面（blob）合并时的展示顺序，须与 useCoverUrl 中 coverSource 一致。
 * ImageWithFallback / CoverImage 应用此逻辑，勿再用 apiPreferServer（那是歌词设置）。
 */
export function pickMergedCoverDisplaySrc({
  coverSource,
  serverSrc,
  serverFailed,
  customBlobUrl,
  hasCustom,
  pinnedSrc,
}: MergedCoverSources): string | undefined {
  if (pinnedSrc) return pinnedSrc
  const serverOk = !!serverSrc && !serverFailed
  const custom = customBlobUrl ?? undefined
  if (!hasCustom) return serverOk ? serverSrc : undefined
  switch (coverSource) {
    case 'server_only':
      return serverOk ? serverSrc : undefined
    case 'remote_only':
      return custom
    case 'remote_first':
      return custom ?? (serverOk ? serverSrc : undefined)
    case 'server_first':
    default:
      return serverOk ? serverSrc : custom
  }
}

/** 读取该歌曲手动钉住的本地封面；未传 songId 时恒为 null */
export function usePinnedCover(songId: string | undefined): string | null {
  const getCover = useCoverCacheStore(s => s.getCover)
  return useMemo(() => (songId ? getCover(songId) : null), [songId, getCover])
}

/**
 * 返回最终要加载的封面 URL
 * - primary: 用户设置的来源（服务器或远程 API）
 * - fallback: 降级备选
 *
 * 手动钉住的本地封面不在此处处理：它由展示组件通过 usePinnedCover +
 * pickMergedCoverDisplaySrc 统一应用，避免出现两套互相竞争的优先级实现。
 */
export function useCoverUrl(
  target: CoverTarget | null | undefined,
  options: UseCoverUrlOptions = {}
): { primary: string | undefined; fallback: string | undefined } {
  const { coverSource, coverRemoteTemplate } = useSettingsStore()
  const { size = 300 } = options

  return useMemo(() => {
    if (!target) return { primary: undefined, fallback: undefined }

    // 服务器封面（需要带鉴权的 URL）
    const serverUrl = target.coverArt && hasAdapter()
      ? getAdapter().getCoverUrl(target.coverArt, size)
      : undefined

    // 远程 API 封面（每次实时请求，不带鉴权）
    const remoteUrl = coverRemoteTemplate
      ? buildRemoteCoverUrl(coverRemoteTemplate, target)
      : undefined

    let primary: string | undefined
    let fallback: string | undefined

    switch (coverSource) {
      case 'server_only':
        primary = serverUrl
        fallback = undefined
        break
      case 'remote_only':
        primary = remoteUrl
        fallback = undefined
        break
      case 'remote_first':
        primary = remoteUrl
        fallback = serverUrl
        break
      case 'server_first':
      default:
        primary = serverUrl
        fallback = remoteUrl
        break
    }

    return { primary, fallback }
  }, [target, coverSource, coverRemoteTemplate, size])
}
