/**
 * 带占位符的图片组件
 * - 使用 IntersectionObserver 实现视口懒加载：只有元素接近可见区域时才发起封面请求
 * - 配置了自定义封面 API 时，与服务器封面并发请求
 * - apiPreferServer=true：优先展示服务器封面，服务器无数据时展示自定义
 * - apiPreferServer=false：优先展示自定义封面，自定义无数据时展示服务器
 * - 所有来源都失败时显示黑胶唱片占位图
 */

import React, { useState, useEffect, useRef } from 'react'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCustomCoverUrl, type CoverQueryType } from '@/hooks/useServerQueries'
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

/** 黑胶唱片 SVG 内联组件 */
function VinylPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-950', className)}>
      <svg viewBox="0 0 100 100" className="w-3/5 h-3/5 opacity-70" xmlns="http://www.w3.org/2000/svg">
        {/* 黑胶外圈 */}
        <circle cx="50" cy="50" r="48" fill="#111" stroke="#333" strokeWidth="1"/>
        {/* 唱片纹路 */}
        {[44,40,36,32,28,24,20].map(r => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#2a2a2a" strokeWidth="0.8"/>
        ))}
        {/* 封面圈 */}
        <circle cx="50" cy="50" r="18" fill="#1a1a1a" stroke="#333" strokeWidth="1"/>
        {/* 封面主色圆 */}
        <circle cx="50" cy="50" r="16" fill="#222"/>
        {/* 光泽反射 */}
        <ellipse cx="44" cy="44" rx="5" ry="3" fill="white" opacity="0.04" transform="rotate(-30 44 44)"/>
        {/* 圆心 */}
        <circle cx="50" cy="50" r="4" fill="#444" stroke="#555" strokeWidth="0.5"/>
        <circle cx="50" cy="50" r="1.5" fill="#888"/>
        {/* 唱片光泽弧光 */}
        <path d="M15 35 Q50 10 85 35" stroke="white" strokeWidth="0.5" fill="none" opacity="0.06"/>
      </svg>
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
  const coverRemoteTemplate = useSettingsStore(s => s.coverRemoteTemplate)
  const apiPreferServer = useSettingsStore(s => s.apiPreferServer)
  const streamBuffering = usePlayerStore(s => s.streamBuffering)

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

  // src 变化时重置所有状态（切歌时避免残留旧状态导致破碎图标）
  useEffect(() => {
    setServerError(false)
    setIsLoaded(false)
  }, [src])

  // 只在进入视口后才请求自定义封面（避免 461 首歌同时发起请求）
  const hasCustomConfig = !!coverRemoteTemplate && !!customCoverParams
  const { data: customCoverDataUrl } = useCustomCoverUrl(
    hasCustomConfig && isVisible ? customCoverParams : null
  )

  // 根据优先级决定要展示的图片 URL（只在可见后才有实际 src）
  let displaySrc: string | undefined
  if (isVisible) {
    if (apiPreferServer || !hasCustomConfig) {
      displaySrc = (!src || serverError)
        ? (customCoverDataUrl ?? undefined)
        : src
    } else {
      displaySrc = customCoverDataUrl ?? (src ?? undefined)
    }
  }

  // 判断是否应该显示占位图：未进入视口 或 所有来源都无数据
  const customFailed = hasCustomConfig ? !customCoverDataUrl : true
  const serverFailed = !src || serverError
  const showPlaceholder = !isVisible || ((serverFailed && customFailed) && !displaySrc)

  if (showPlaceholder) {
    if (fallbackType === 'artist') {
      return (
        <div
          ref={containerRef}
          className={cn(
            'flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900',
            className, fallbackClassName
          )}
          aria-label={alt}
        >
          <User className="w-1/3 h-1/3 text-white/25" />
        </div>
      )
    }
    return (
      <div ref={containerRef} className={cn(className, fallbackClassName)}>
        <VinylPlaceholder className="w-full h-full" />
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {!isLoaded && (
        <VinylPlaceholder className="absolute inset-0 animate-pulse" />
      )}
      <img
        src={(streamBuffering && !isLoaded && !eager) ? undefined : displaySrc}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'auto' : 'low'}
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
