/**
 * CoverImage - 带 fallback 的封面图组件
 * - 使用 IntersectionObserver 实现视口懒加载：只有元素接近可见区域时才发起封面请求
 * - 配置了自定义封面 API 时，与服务器封面并发请求
 * - apiPreferServer=true：优先服务器，服务器失败才用自定义
 * - apiPreferServer=false：优先自定义，自定义不可用才用服务器
 * - 所有来源都失败时显示黑胶唱片占位图
 */

import { useState, useEffect, useRef } from 'react'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCustomCoverUrl, type CoverQueryType } from '@/hooks/useServerQueries'
import { useSettingsStore } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'

interface CoverImageProps {
  primary?: string
  fallback?: string
  alt?: string
  className?: string
  /** artist 类型用人像占位，其他用黑胶 */
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
}

function VinylPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-950', className)}>
      <svg viewBox="0 0 100 100" className="w-3/5 h-3/5 opacity-70" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="48" fill="#111" stroke="#333" strokeWidth="1"/>
        {[44,40,36,32,28,24,20].map(r => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="#2a2a2a" strokeWidth="0.8"/>
        ))}
        <circle cx="50" cy="50" r="18" fill="#1a1a1a" stroke="#333" strokeWidth="1"/>
        <circle cx="50" cy="50" r="16" fill="#222"/>
        <ellipse cx="44" cy="44" rx="5" ry="3" fill="white" opacity="0.04" transform="rotate(-30 44 44)"/>
        <circle cx="50" cy="50" r="4" fill="#444" stroke="#555" strokeWidth="0.5"/>
        <circle cx="50" cy="50" r="1.5" fill="#888"/>
        <path d="M15 35 Q50 10 85 35" stroke="white" strokeWidth="0.5" fill="none" opacity="0.06"/>
      </svg>
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
}: CoverImageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(!!eager)
  const [serverError, setServerError] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  /**
   * imgLoadKey — eager 模式下每次 primary 变化或 streamBuffering 恢复时自增，
   * 作为 <img key> 强制 React 重建 img 元素，保证浏览器一定发出新请求。
   * 解决问题：abortPendingImageLoads 可能在 React 更新 DOM 之前清空 img.src，
   * 而 React 因 src prop 值未变不会重设 DOM，导致 img 永久空白。
   */
  const [imgLoadKey, setImgLoadKey] = useState(0)
  const coverRemoteTemplate = useSettingsStore(s => s.coverRemoteTemplate)
  const apiPreferServer = useSettingsStore(s => s.apiPreferServer)
  const streamBuffering = usePlayerStore(s => s.streamBuffering)
  const streamBufferingPrevRef = useRef(streamBuffering)

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

  // primary 变化时重置错误和加载状态（切歌时保证先显示黑胶再显示新封面）
  // eager 模式下同时自增 imgLoadKey，强制重建 img 元素
  useEffect(() => {
    setServerError(false)
    setIsLoaded(false)
    if (eager) setImgLoadKey(k => k + 1)
  }, [primary, eager])

  // eager 模式下：streamBuffering 从 true→false 时再次强制重建 img
  // 作为兜底：即使 img.src 曾被 abortPendingImageLoads 意外清除，也能自动修复
  useEffect(() => {
    const prevBuffering = streamBufferingPrevRef.current
    streamBufferingPrevRef.current = streamBuffering
    if (eager && prevBuffering && !streamBuffering) {
      setIsLoaded(false)
      setImgLoadKey(k => k + 1)
    }
  }, [streamBuffering, eager])

  // 根据优先级决定展示的 URL（只在可见后才有实际 src）
  let displaySrc: string | undefined
  if (isVisible) {
    if (apiPreferServer || !hasCustomConfig) {
      // 服务器优先：仅在服务器地址有效且未报错时使用服务器，否则回退到自定义
      const serverAvailable = !!(primary || fallback)
      if (!serverAvailable || serverError) {
        displaySrc = customCoverDataUrl ?? fallback
      } else {
        displaySrc = primary ?? fallback
      }
    } else {
      displaySrc = customCoverDataUrl ?? primary ?? fallback
    }
  }

  // 通知父组件已解析的封面 URL（用于颜色提取、背景模糊等）
  useEffect(() => {
    if (displaySrc && onImageResolved) onImageResolved(displaySrc)
  }, [displaySrc, onImageResolved])

  // 所有来源都无数据时展示占位图
  const customFailed = hasCustomConfig ? !customCoverDataUrl : true
  const serverFailed = (!primary && !fallback) || serverError
  const showPlaceholder = !isVisible || ((serverFailed && customFailed) && !displaySrc)

  if (showPlaceholder) {
    if (type === 'artist') {
      return (
        <div ref={containerRef} className={cn('flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900', className)}>
          <User className="w-1/3 h-1/3 text-white/25" />
        </div>
      )
    }
    return (
      <div ref={containerRef} className={className}>
        <VinylPlaceholder className="w-full h-full" />
      </div>
    )
  }

  if (!displaySrc) {
    if (type === 'artist') {
      return (
        <div ref={containerRef} className={cn('flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900', className)}>
          <User className="w-1/3 h-1/3 text-white/25" />
        </div>
      )
    }
    return (
      <div ref={containerRef} className={className}>
        <VinylPlaceholder className="w-full h-full" />
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* 图片加载中时显示黑胶占位，防止出现破损图标 */}
      {!isLoaded && (
        <VinylPlaceholder className="absolute inset-0" />
      )}
      <img
        key={eager ? imgLoadKey : undefined}
        src={(streamBuffering && !eager) ? undefined : displaySrc}
        alt={alt}
        className={cn('block w-full h-full object-cover', !isLoaded && 'opacity-0')}
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (!serverError) {
            setServerError(true)
            setIsLoaded(false)
          }
        }}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchpriority={eager ? 'auto' : 'low'}
        data-no-abort={eager ? 'true' : undefined}
      />
    </div>
  )
}
