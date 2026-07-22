/**
 * 带占位符的图片组件
 * - 使用 IntersectionObserver 实现视口懒加载：只有元素接近可见区域时才发起封面请求
 * - 配置了自定义封面 API 时，与服务器封面并发请求
 * - 与设置「封面来源」(coverSource) 一致；勿使用 apiPreferServer（那是歌词 API 优先级）
 * - 所有来源都失败时显示纸面占位（paper-deep 底 + ink-faint 图标）
 */

import React, { useState, useEffect, useRef } from 'react'
import { User, MusicNote } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useCustomCoverUrl, type CoverQueryType } from '@/hooks/useServerQueries'
import { pickMergedCoverDisplaySrc } from '@/hooks/useCoverUrl'
import { useSettingsStore } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'

interface ImageWithFallbackProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** 占位符类型 */
  fallbackType?: 'music' | 'album' | 'artist'
  /** 额外的占位符 CSS 类 */
  fallbackClassName?: string
  /** 自定义封面 API 参数（配置了自定义接口时并发请求）*/
  customCoverParams?: {
    type: CoverQueryType
    title?: string
    artist?: string
    album?: string
    path?: string
  }
  /**
   * 高优先级模式：跳过 loading="lazy"、fetchPriority="low" 和 stream-buffering 延迟
   * 用于 PlayerBar、FullscreenPlayer 等始终可见的封面
   */
  eager?: boolean
}

/** 纸面占位：paper-deep 底 + ink-faint 图标（DESIGN v2 §4.5），圆角由消费方控制 */
function CoverPlaceholder({
  className,
  artist = false,
}: {
  className?: string
  artist?: boolean
}) {
  const Icon = artist ? User : MusicNote
  return (
    <div className={cn('flex items-center justify-center bg-paper-deep text-ink-faint/70', className)}>
      <Icon className="w-1/3 h-1/3" />
    </div>
  )
}

export function ImageWithFallback({
  src,
  alt,
  className,
  fallbackType = 'music',
  fallbackClassName,
  customCoverParams,
  eager = false,
  ...props
}: ImageWithFallbackProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(!!eager)
  const [serverError, setServerError] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  /**
   * eager 模式下用于强制重建 <img>，确保浏览器一定重新发起请求。
   * 避免在快速切歌时 img.src 被底层中止后，React 因 src prop 未变而不重设 DOM。
   */
  const [imgLoadKey, setImgLoadKey] = useState(0)
  const coverRemoteTemplate = useSettingsStore(s => s.coverRemoteTemplate)
  const coverSource = useSettingsStore(s => s.coverSource)
  const streamBuffering = usePlayerStore(s => s.streamBuffering)
  const streamBufferingPrevRef = useRef(streamBuffering)

  // IntersectionObserver: 只在元素接近可视区域时才开始加载封面
  // eager 模式（PlayerBar / FullscreenPlayer）跳过观察，立即加载
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
      { rootMargin: '200px' } // 提前 200px 开始加载
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [eager])

  // src 或自定义查询参数变化时重置（避免切歌后仍短暂显示上一张自定义封面）
  const customKey = customCoverParams
    ? `${customCoverParams.title ?? ''}|${customCoverParams.artist ?? ''}|${customCoverParams.album ?? ''}|${customCoverParams.path ?? ''}`
    : ''
  useEffect(() => {
    setServerError(false)
    setIsLoaded(false)
    if (eager) setImgLoadKey(k => k + 1)
  }, [src, customKey, eager])

  // eager 模式兜底：streamBuffering 从 true->false 时强制重建 img
  useEffect(() => {
    const prevBuffering = streamBufferingPrevRef.current
    streamBufferingPrevRef.current = streamBuffering
    if (eager && prevBuffering && !streamBuffering) {
      setIsLoaded(false)
      setImgLoadKey(k => k + 1)
    }
  }, [streamBuffering, eager])

  // 只在进入视口后才请求自定义封面（避免 461 首歌同时发起请求）
  const hasCustomConfig = !!coverRemoteTemplate && !!customCoverParams
  const { data: customCoverDataUrl } = useCustomCoverUrl(
    hasCustomConfig && isVisible ? customCoverParams : null
  )

  let displaySrc: string | undefined
  if (isVisible) {
    displaySrc = pickMergedCoverDisplaySrc(
      coverSource,
      src,
      serverError,
      customCoverDataUrl,
      hasCustomConfig
    )
  }

  // 判断是否应该显示占位图：未进入视口 或 所有来源都无数据
  const customFailed = hasCustomConfig ? !customCoverDataUrl : true
  const serverFailed = !src || serverError
  const showPlaceholder = !isVisible || ((serverFailed && customFailed) && !displaySrc)

  if (showPlaceholder) {
    return (
      <div ref={containerRef} className={cn(className, fallbackClassName)} aria-label={alt}>
        <CoverPlaceholder className="w-full h-full" artist={fallbackType === 'artist'} />
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {!isLoaded && (
        // loading 骨架：hair 系纸面占位闪烁（不用 spinner，DESIGN §4.5）
        <CoverPlaceholder className="absolute inset-0 animate-pulse" artist={fallbackType === 'artist'} />
      )}
      <img
        key={eager ? imgLoadKey : undefined}
        src={(streamBuffering && !isLoaded && !eager) ? undefined : displaySrc}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'auto' : 'low'}
        data-no-abort={eager ? 'true' : undefined}
        className={cn('block w-full h-full object-cover', !isLoaded && 'opacity-0', className)}
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (!serverError) {
            setServerError(true)
            setIsLoaded(false)
          }
        }}
        {...props}
      />
    </div>
  )
}
