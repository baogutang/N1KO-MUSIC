/**
 * useCoverUrl - 统一封面图 URL 解析
 *
 * 根据用户设置的 coverSource 决定优先使用服务器封面还是远程 API 封面
 */

import { useMemo } from 'react'
import { useSettingsStore, buildRemoteCoverUrl } from '@/store/settingsStore'
import { getAdapter, hasAdapter } from '@/api'

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
 * 返回最终要加载的封面 URL 数组（按优先级排列，前者加载失败则用后者）
 */
export function useCoverUrl(
  target: CoverTarget | null | undefined,
  options: UseCoverUrlOptions = {}
): { primary: string | undefined; fallback: string | undefined } {
  const { coverSource, coverRemoteTemplate } = useSettingsStore()
  const { size = 300 } = options

  return useMemo(() => {
    if (!target) return { primary: undefined, fallback: undefined }

    const serverUrl = target.coverArt && hasAdapter()
      ? getAdapter().getCoverUrl(target.coverArt, size)
      : undefined

    const remoteUrl = coverRemoteTemplate
      ? buildRemoteCoverUrl(coverRemoteTemplate, target)
      : undefined

    switch (coverSource) {
      case 'server_only':
        return { primary: serverUrl, fallback: undefined }
      case 'remote_only':
        return { primary: remoteUrl, fallback: undefined }
      case 'remote_first':
        return { primary: remoteUrl, fallback: serverUrl }
      case 'server_first':
      default:
        return { primary: serverUrl, fallback: remoteUrl }
    }
  }, [target?.coverArt, target?.artist, target?.album, target?.title, target?.id, target?.path, coverSource, coverRemoteTemplate, size])
}

/** 单值版本：只返回最终 URL（primary 优先，无则 fallback）*/
export function useSingleCoverUrl(
  target: CoverTarget | null | undefined,
  options: UseCoverUrlOptions = {}
): string | undefined {
  const { primary, fallback } = useCoverUrl(target, options)
  return primary ?? fallback
}
