/**
 * CoverImage - 带 fallback 的封面图组件
 * - 使用 IntersectionObserver 实现视口懒加载：只有元素接近可见区域时才发起封面请求
 * - 配置了自定义封面 API 时，与服务器封面并发请求
 * - 与设置「封面来源」(coverSource) 一致
 * - 所有来源都失败时显示黑胶唱片占位图
 */

import { useState, useEffect, useRef } from 'react'
import { User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCustomCoverUrl, type CoverQueryType } from '@/hooks/useServerQueries'
import { pickMergedCoverDisplaySrc } from '@/hooks/useCoverUrl'
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
  // eager 模式初始即可见，lazy 模式需等待 IntersectionObserver
  const [isVisible, setIsVisible] = useState(!!eager)
  const [serverError, setServerError] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const coverRemoteTemplate = useSettingsStore(s => s.coverRemoteTemplate)
  const coverSource = useSettingsStore(s => s.coverSource)
  // eager 模式下 streamBuffering 不阻塞加载，只有 lazy 模式才延迟
  const streamBuffering = usePlayerStore(s => s.streamBuffering)

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

  // primary 变化时重置错误和加载状态
  useEffect(() => {
    setServerError(false)
    setIsLoaded(false)
  }, [primary])

  // 根据优先级决定展示的 URL
  let displaySrc: string | undefined
  if (isVisible) {
    const serverSrc = primary ?? fallback
    displaySrc = pickMergedCoverDisplaySrc(
      coverSource,
      serverSrc,
      serverError,
      customCoverDataUrl,
      hasCustomConfig
    )
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
    const showVinyl = !src || !isLoaded
    return (
      <div ref={containerRef} className={cn('relative', className)}>
        {showVinyl && <VinylPlaceholder className="absolute inset-0" />}
        {src && (
          <img
            src={src}
            alt={alt}
            className={cn('w-full h-full object-cover', !isLoaded && 'opacity-0')}
            onLoad={() => {
              setIsLoaded(true)
              onImageResolved?.(src)
            }}
            onError={() => {
              if (!serverError) {
                setServerError(true)
                setIsLoaded(false)
              }
            }}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            data-no-abort="true"
          />
        )}
      </div>
    )
  }

  // ─── lazy 模式（非 eager）────────────────────────────────────────────────────
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
      {!isLoaded && <VinylPlaceholder className="absolute inset-0" />}
      <img
        src={(streamBuffering && !isLoaded) ? undefined : displaySrc}
        alt={alt}
        className={cn('w-full h-full object-cover', !isLoaded && 'opacity-0')}
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          if (!serverError) {
            setServerError(true)
            setIsLoaded(false)
          }
        }}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
      />
    </div>
  )
}
