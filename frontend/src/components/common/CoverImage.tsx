/**
 * CoverImage - 带 fallback 的封面图组件
 * - 使用 IntersectionObserver 实现视口懒加载：只有元素接近可见区域时才发起封面请求
 * - 配置了自定义封面 API 时，与服务器封面并发请求
 * - 与设置「封面来源」(coverSource) 一致
 * - 所有来源都失败时显示占位（下沉一档的底 + 居中的浅墨图标）；图片到了淡入，不是一下子跳出来
 * - 这一次会话里已经加载过的地址不再淡入，直接是实的：全屏播放器打开时大封面正在从迷你条飞过去，
 *   每次新挂载都从透明淡入 500ms 的话，飞行的前半段封面是虚的；回到看过的页面也不该再闪一遍
 */

import { useState, useEffect, useRef } from 'react'
import { User, MusicNote } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useCustomCoverUrl, type CoverQueryType } from '@/hooks/useServerQueries'
import { pickMergedCoverDisplaySrc, usePinnedCover } from '@/hooks/useCoverUrl'
import { useSettingsStore } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'

interface CoverImageProps {
  primary?: string
  fallback?: string
  alt?: string
  className?: string
  /** artist 类型用人像占位，其他用音符 */
  type?: 'music' | 'artist'
  /** 自定义封面 API 参数 */
  customCoverParams?: {
    type: CoverQueryType
    title?: string
    artist?: string
    album?: string
    path?: string
  }
  onImageResolved?: (resolvedUrl: string) => void
  /** 高优先级模式：跳过 lazy/low-priority 和 stream-buffering 延迟 */
  eager?: boolean
  /** 歌曲 id；传入后会优先使用用户在详情页手动钉住的本地封面 */
  songId?: string
}

/** 这次会话里已经加载成功的封面地址（浏览器缓存里有、解码过）：再出现时直接显示，不放占位、不淡入。
 *  只留最近 600 个，Set 按插入顺序，满了丢最早的 */
const loadedSrcs = new Set<string>()
export function markCoverLoaded(src: string) {
  loadedSrcs.delete(src)
  loadedSrcs.add(src)
  if (loadedSrcs.size > 600) loadedSrcs.delete(loadedSrcs.values().next().value as string)
}

/** 占位：下沉一档的底 + 居中的浅墨图标，圆角继承父级（由消费方控制） */
function CoverPlaceholder({
  className,
  artist = false,
}: {
  className?: string
  artist?: boolean
}) {
  const Icon = artist ? User : MusicNote
  return (
    <div className={cn('flex items-center justify-center rounded-[inherit] bg-fill text-ink-3/70', className)}>
      <Icon className="h-1/3 w-1/3" aria-hidden="true" />
    </div>
  )
}

export function CoverImage({
  primary,
  fallback,
  alt = '',
  className,
  type = 'music',
  customCoverParams,
  onImageResolved,
  eager = false,
  songId,
}: CoverImageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // eager 模式初始即可见，lazy 模式需等待 IntersectionObserver
  const [isVisible, setIsVisible] = useState(!!eager)
  // primary 与 fallback 分别记录失败：primary 出错后需降级尝试 fallback，而不是直接放弃服务器来源
  const [primaryError, setPrimaryError] = useState(false)
  const [fallbackError, setFallbackError] = useState(false)
  const [pinnedFailed, setPinnedFailed] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const coverRemoteTemplate = useSettingsStore(s => s.coverRemoteTemplate)
  const coverSource = useSettingsStore(s => s.coverSource)
  // eager 模式下 streamBuffering 不阻塞加载，只有 lazy 模式才延迟；已经加载出来的封面不订阅它
  // （切歌时它翻一次，一屏几十张封面跟着重渲染，正好撞在切歌动画上）
  const streamBuffering = usePlayerStore(s => !eager && !isLoaded && s.streamBuffering)

  // IntersectionObserver: 只在元素接近可视区域时才开始加载封面
  useEffect(() => {
    if (eager) return
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [eager])

  // 只在进入视口后才请求自定义封面
  const hasCustomConfig = !!coverRemoteTemplate && !!customCoverParams
  const { data: customCoverDataUrl } = useCustomCoverUrl(
    hasCustomConfig && isVisible ? customCoverParams : null
  )
  const pinnedCover = usePinnedCover(songId)
  // 钉住的地址可能失效（远端删图/断网），失败后必须让位给服务器与自定义来源
  const pinnedSrc = pinnedFailed ? null : pinnedCover

  // primary/fallback 变化时重置错误和加载状态
  useEffect(() => {
    setPrimaryError(false)
    setFallbackError(false)
    setPinnedFailed(false)
    setIsLoaded(false)
  }, [primary, fallback, songId])

  // 服务器来源：primary 可用则用 primary，出错后降级到 fallback，两者都失败才算耗尽
  const serverSrc = primary && !primaryError
    ? primary
    : (fallback && !fallbackError ? fallback : undefined)

  // 根据优先级决定展示的 URL
  let displaySrc: string | undefined
  if (isVisible) {
    displaySrc = pickMergedCoverDisplaySrc({
      coverSource,
      serverSrc,
      serverFailed: !serverSrc,
      customBlobUrl: customCoverDataUrl,
      hasCustom: hasCustomConfig,
      pinnedSrc,
    })
  }

  // 标记出错的那个服务器来源（自定义封面 blob 出错不影响服务器来源）
  const handleImgError = (failedSrc: string) => {
    if (pinnedSrc && failedSrc === pinnedSrc) {
      setPinnedFailed(true)
      setIsLoaded(false)
      return
    }
    if (failedSrc === primary) {
      if (!primaryError) {
        setPrimaryError(true)
        setIsLoaded(false)
      }
    } else if (failedSrc === fallback) {
      if (!fallbackError) {
        setFallbackError(true)
        setIsLoaded(false)
      }
    }
  }

  // 通知父组件已解析的封面 URL（用于颜色提取、背景模糊等）
  // eager 模式下延迟到图片实际加载完成，避免与封面请求竞争 HTTP 连接。
  // lazy 模式下仍使用 displaySrc 变化时触发（因为不紧急）。
  useEffect(() => {
    if (!eager && displaySrc && onImageResolved) onImageResolved(displaySrc)
  }, [eager, displaySrc, onImageResolved])



  // ─── eager 模式渲染 ────────────────────────────────────────────────────────
  // 使用普通 <img> 标签，浏览器自动处理 HTTP 缓存和连接管理。
  // onImageResolved 延迟到图片实际加载完成后调用，避免与封面请求竞争连接。
  if (eager) {
    const src = displaySrc
    const known = !!src && loadedSrcs.has(src)
    const showPlaceholder = !src || (!isLoaded && !known)
    return (
      <div ref={containerRef} className={cn('relative', className)}>
        {showPlaceholder && (
          // loading 骨架：纸面占位闪烁（不用 spinner，DESIGN §4.5）
          <CoverPlaceholder className="absolute inset-0 animate-pulse motion-reduce:animate-none" artist={type === 'artist'} />
        )}
        {src && (
          <img
            src={src}
            alt={alt}
            className={cn('w-full h-full object-cover', !known && 'transition-opacity duration-500 ease-out', !isLoaded && !known && 'opacity-0')}
            onLoad={() => {
              markCoverLoaded(src)
              setIsLoaded(true)
              onImageResolved?.(src)
            }}
            onError={() => handleImgError(src)}
            loading="eager"
            decoding="async"
            {...{ fetchpriority: "high" }}
            data-no-abort="true"
          />
        )}
      </div>
    )
  }

  // ─── lazy 模式（非 eager）────────────────────────────────────────────────────
  const customFailed = hasCustomConfig ? !customCoverDataUrl : true
  const serverFailed = !serverSrc
  const showPlaceholder = !isVisible || ((serverFailed && customFailed) && !displaySrc)

  if (showPlaceholder || !displaySrc) {
    return (
      <div ref={containerRef} className={className}>
        <CoverPlaceholder className="w-full h-full" artist={type === 'artist'} />
      </div>
    )
  }

  const known = loadedSrcs.has(displaySrc)
  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {!isLoaded && !known && (
        // loading 骨架：纸面占位闪烁（不用 spinner，DESIGN §4.5）
        <CoverPlaceholder className="absolute inset-0 animate-pulse motion-reduce:animate-none" artist={type === 'artist'} />
      )}
      <img
        src={(streamBuffering && !isLoaded && !known) ? undefined : displaySrc}
        alt={alt}
        className={cn('w-full h-full object-cover', !known && 'transition-opacity duration-500 ease-out', !isLoaded && !known && 'opacity-0')}
        onLoad={() => { markCoverLoaded(displaySrc); setIsLoaded(true) }}
        onError={() => displaySrc && handleImgError(displaySrc)}
        loading="lazy"
        decoding="async"
        {...{ fetchpriority: "low" }}
      />
    </div>
  )
}
