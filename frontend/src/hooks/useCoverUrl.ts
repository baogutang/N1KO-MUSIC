/**
 * useCoverUrl - 统一封面图 URL 解析
 *
 * 优先级：本地缓存（用户手动搜索保存的） > 用户配置的封面来源 > 服务器封面
 */

import { useMemo } from 'react'
import { useSettingsStore, buildRemoteCoverUrl } from '@/store/settingsStore'
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

/**
 * 返回最终要加载的封面 URL
 * - cached: 本地缓存（用户手动搜索保存的），优先级最高
 * - primary: 用户设置的来源（服务器或远程 API）
 * - fallback: 降级备选
 */
export function useCoverUrl(
  target: CoverTarget | null | undefined,
  options: UseCoverUrlOptions = {}
): { cached: string | undefined; primary: string | undefined; fallback: string | undefined } {
  const { coverSource, coverRemoteTemplate } = useSettingsStore()
  const getCachedCover = useCoverCacheStore(s => s.getCover)
  const { size = 300 } = options

  return useMemo(() => {
    if (!target) return { cached: undefined, primary: undefined, fallback: undefined }

    // 最高优先级：本地手动缓存的封面（用户通过详情页搜索保存的）
    const cached = target.id ? (getCachedCover(target.id) ?? undefined) : undefined

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
        fallback = remoteUrl
        break
      case 'remote_only':
        primary = remoteUrl
        fallback = serverUrl
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

    return { cached, primary, fallback }
  }, [target?.coverArt, target?.artist, target?.album, target?.title, target?.id, target?.path, coverSource, coverRemoteTemplate, size, getCachedCover])
}

/** 单值版本：返回最终要使用的 URL（cached > primary > fallback）*/
export function useSingleCoverUrl(
  target: CoverTarget | null | undefined,
  options: UseCoverUrlOptions = {}
): string | undefined {
  const { cached, primary, fallback } = useCoverUrl(target, options)
  return cached ?? primary ?? fallback
}
