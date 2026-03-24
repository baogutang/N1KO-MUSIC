/**
 * 歌曲详情页
 * - 通过 router state 传入 Song 对象（navigate('/songs/detail', { state: { song } })）
 * - 分「基础」「扩展」两块，布局参考 macOS 音乐信息面板
 * - 支持编辑元信息（标题、专辑、歌手、年份、流派、音轨号），保存到本地缓存
 * - 支持自定义歌词 API 搜索（可自定义查询参数）、预览后保存到本地缓存
 * - 支持自定义封面 API 搜索，预览后保存到本地缓存
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  Music2, Disc3, User, Users, AlignLeft,
  Calendar, Hash, Layers, FileAudio,
  HardDrive, Gauge, Clock, PlayCircle, Timer, FolderOpen,
  ArrowRight, Edit2, Save, X, RefreshCw, Search, ImageIcon
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDuration, formatFileSize } from '@/utils/formatters'
import { usePlayerStore } from '@/store/playerStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useLyricCacheStore } from '@/store/o3icCacheStore'
import { useMetadataCacheStore } from '@/store/metadataCacheStore'
import { useCoverCacheStore } from '@/store/coverCacheStore'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import type { Song } from '@/api/types'

// ─── 子组件 ───────────────────────────────────────────────────────────────────

interface SectionProps {
  title: string
  children: React.ReactNode
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="mb-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium px-4 mb-1.5">
        {title}
      </p>
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden divide-y divide-border/50">
        {children}
      </div>
    </div>
  )
}

interface RowProps {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  onClick?: () => void
  linkable?: boolean
  editable?: boolean
  onEdit?: () => void
}

function Row({ icon, label, value, onClick, linkable, editable, onEdit }: RowProps) {
  const inner = (
    <>
      <div className="flex items-center gap-3 text-muted-foreground flex-shrink-0 w-36">
        <span className="flex-shrink-0">{icon}</span>
        <span className="text-sm text-foreground/80">{label}</span>
      </div>
      <div className="flex-1 text-right flex items-center justify-end gap-1 min-w-0">
        <span className="text-sm text-foreground/70 truncate text-right">{value}</span>
        {linkable && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
        {editable && onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </>
  )

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-accent/50 transition-colors text-left"
      >
        {inner}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {inner}
    </div>
  )
}

// ─── 编辑对话框 ────────────────────────────────────────────────────────────────

/** 文本字段编辑对话框 */
interface EditFieldDialogProps {
  open: boolean
  onClose: () => void
  title: string
  label: string
  initialValue: string
  placeholder?: string
  onSave: (val: string) => Promise<void>
}

function EditFieldDialog({ open, onClose, title, label, initialValue, placeholder, onSave }: EditFieldDialogProps) {
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const handleSave = async () => {
    const trimmed = value.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await onSave(trimmed)
    } catch (err) {
      toast({
        title: '保存失败',
        description: (err as Error).message || '请重试',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <label className="text-sm text-muted-foreground">{label}</label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') onClose()
            }}
            placeholder={placeholder ?? `请输入${label}`}
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 mr-1.5" />取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !value.trim()}>
            {saving
              ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />保存中...</>
              : <><Save className="w-4 h-4 mr-1.5" />保存</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 数字字段编辑对话框 */
interface EditNumberDialogProps {
  open: boolean
  onClose: () => void
  title: string
  label: string
  initialValue: number | null
  placeholder?: string
  onSave: (val: number) => Promise<void>
}

function EditNumberDialog({ open, onClose, title, label, initialValue, placeholder, onSave }: EditNumberDialogProps) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setValue(initialValue != null ? String(initialValue) : '')
  }, [open, initialValue])

  const handleSave = async () => {
    const num = parseInt(value.trim(), 10)
    if (isNaN(num)) return
    setSaving(true)
    try {
      await onSave(num)
    } catch (err) {
      toast({
        title: '保存失败',
        description: (err as Error).message || '请重试',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <label className="text-sm text-muted-foreground">{label}</label>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') onClose()
            }}
            placeholder={placeholder ?? `请输入${label}`}
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 mr-1.5" />取消
          </Button>
          <Button onClick={handleSave} disabled={saving || value.trim() === ''}>
            {saving
              ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />保存中...</>
              : <><Save className="w-4 h-4 mr-1.5" />保存</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 封面搜索对话框 ───────────────────────────────────────────────────────────

interface CoverSearchResult {
  id: string
  url: string
  title: string
  artist: string
  album: string
}

interface CoverSearchDialogProps {
  open: boolean
  onClose: () => void
  song: Song
  initialCoverUrl: string | null
  onSave: (url: string) => void
}

function CoverSearchDialog({ open, onClose, song, initialCoverUrl, onSave }: CoverSearchDialogProps) {
  const { coverRemoteTemplate, apiAuthToken } = useSettingsStore()

  const [searchTitle, setSearchTitle] = useState(song.title)
  const [searchArtist, setSearchArtist] = useState(song.artist)
  const [searchAlbum, setSearchAlbum] = useState(song.album)

  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<CoverSearchResult[]>([])
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setSearchTitle(song.title)
      setSearchArtist(song.artist)
      setSearchAlbum(song.album)
      setSearchResults([])
      setSelectedUrl(initialCoverUrl)
      setSearchError(null)
      setSearching(false)
      setSaving(false)
    }
  }, [open, song, initialCoverUrl])

  /** 构建封面 API URL */
  function buildCoverUrl(): string {
    if (!coverRemoteTemplate) return ''
    const url = new URL(coverRemoteTemplate)
    if (searchTitle)  url.searchParams.set('title', searchTitle)
    if (searchArtist) url.searchParams.set('artist', searchArtist)
    if (searchAlbum)  url.searchParams.set('album', searchAlbum)
    if (song.path)    url.searchParams.set('path', song.path)
    return url.toString()
  }

  function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('读取图片失败'))
      reader.readAsDataURL(blob)
    })
  }

  /** 解析 API 返回的封面数据（JSON 或纯文本 URL） */
  function parseCoversFromResponse(text: string): CoverSearchResult[] {
    try {
      const json = JSON.parse(text)
      const list: unknown[] = Array.isArray(json) ? json : [json]
      const results: CoverSearchResult[] = []

      for (const item of list) {
        const record = item as Record<string, unknown>
        // 尝试多种常见字段名（含外链与 data URL）
        const raw = String(
          record?.url ?? record?.cover ?? record?.image ?? record?.img ?? record?.src ?? ''
        )
        const url = raw.trim()
        const ok =
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url.startsWith('data:image/')
        if (url && ok) {
          results.push({
            id: String(record?.id ?? results.length),
            url,
            title: String(record?.title ?? ''),
            artist: String(record?.artist ?? ''),
            album: String(record?.album ?? ''),
          })
        }
      }

      return results
    } catch {
      const trimmed = text.trim()
      if (
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('data:image/')
      ) {
        return [{ id: '0', url: trimmed, title: '', artist: '', album: '' }]
      }
      return []
    }
  }

  const handleSearch = async () => {
    if (!coverRemoteTemplate) {
      toast({ title: '请先在设置中配置自定义封面 API', variant: 'destructive' })
      return
    }

    setSearching(true)
    setSearchError(null)
    setSearchResults([])

    try {
      const url = buildCoverUrl()
      const headers: Record<string, string> = {}
      if (apiAuthToken) headers['Authorization'] = apiAuthToken

      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      const buf = await res.arrayBuffer()
      if (!buf.byteLength) {
        setSearchError('接口返回空内容')
        return
      }

      /** 从二进制头推断图片 MIME（应对 octet-stream 实际为图片） */
      function sniffImageMime(bytes: ArrayBuffer): string | null {
        const u = new Uint8Array(bytes.slice(0, 16))
        if (u.length < 3) return null
        if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'image/jpeg'
        if (u.length >= 4 && u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return 'image/png'
        if (u.length >= 3 && u[0] === 0x47 && u[1] === 0x49 && u[2] === 0x46) return 'image/gif'
        if (
          u.length >= 12 &&
          u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 &&
          u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50
        ) return 'image/webp'
        return null
      }

      // 接口直接返回图片二进制（webp/jpeg/png 等）——不能用 text()+JSON 解析
      if (contentType.startsWith('image/')) {
        const blob = new Blob([buf], { type: contentType })
        const dataUrl = await blobToDataUrl(blob)
        const results: CoverSearchResult[] = [{
          id: '0',
          url: dataUrl,
          title: searchTitle,
          artist: searchArtist,
          album: searchAlbum,
        }]
        setSearchResults(results)
        setSelectedUrl(dataUrl)
        return
      }

      const text = new TextDecoder('utf-8').decode(buf)
      let results = parseCoversFromResponse(text)

      // application/octet-stream 等但实际为图片
      if (results.length === 0) {
        const sniffed = sniffImageMime(buf)
        if (sniffed) {
          const blob = new Blob([buf], { type: sniffed })
          const dataUrl = await blobToDataUrl(blob)
          results = [{
            id: '0',
            url: dataUrl,
            title: searchTitle,
            artist: searchArtist,
            album: searchAlbum,
          }]
        }
      }

      if (results.length === 0) {
        setSearchError('未找到封面，请尝试调整查询参数')
        return
      }

      setSearchResults(results)
      setSelectedUrl(results[0].url)
    } catch (err) {
      toast({
        title: '查询失败',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setSearching(false)
    }
  }

  const handleConfirm = async () => {
    if (!selectedUrl) return
    setSaving(true)
    try {
      onSave(selectedUrl)
      onClose()
    } catch (err) {
      toast({
        title: '保存失败',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-2xl flex flex-col max-h-[85vh]"
        style={{ animation: 'none' }}
      >
        <DialogHeader>
          <DialogTitle>搜索封面</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 flex-1 overflow-hidden flex flex-col">
          <p className="text-xs text-muted-foreground flex-shrink-0">
            自定义查询参数，支持手动修改以获得更精确的搜索结果
          </p>

          <div className="space-y-2 flex-shrink-0">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">歌曲标题</label>
                <input
                  type="text"
                  value={searchTitle}
                  onChange={(e) => setSearchTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">歌手</label>
                <input
                  type="text"
                  value={searchArtist}
                  onChange={(e) => setSearchArtist(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">专辑</label>
                <input
                  type="text"
                  value={searchAlbum}
                  onChange={(e) => setSearchAlbum(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            <Button
              onClick={handleSearch}
              disabled={searching || !searchTitle.trim()}
              className="w-full"
              size="sm"
            >
              {searching
                ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />搜索中...</>
                : <><Search className="w-4 h-4 mr-1.5" />搜索封面</>
              }
            </Button>
          </div>

          {searchError && (
            <p className="text-xs text-destructive px-1 flex-shrink-0">{searchError}</p>
          )}

          {/* 封面预览 */}
          {selectedUrl && (
            <div className="flex-shrink-0">
              <p className="text-xs text-muted-foreground mb-2">
                封面预览（{searchResults.length > 0 ? `${searchResults.findIndex(r => r.url === selectedUrl) + 1} / ${searchResults.length}` : '当前选中'})
              </p>
              <div className="flex gap-4">
                {/* 选中封面大图预览 */}
                <div className="flex-shrink-0">
                  <img
                    src={selectedUrl}
                    alt="封面预览"
                    className="w-48 h-48 object-cover rounded-lg border border-border/60 bg-muted"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><text x="50" y="55" text-anchor="middle" fill="%23666" font-size="12">加载失败</text></svg>'
                    }}
                  />
                </div>

                {/* 搜索结果缩略图列表 */}
                {searchResults.length > 1 && (
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground mb-1">点击切换</p>
                    <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                      {searchResults.map((result, index) => (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => setSelectedUrl(result.url)}
                          className={cn(
                            'relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all',
                            selectedUrl === result.url
                              ? 'border-primary ring-2 ring-primary/30'
                              : 'border-transparent hover:border-border'
                          )}
                        >
                          <img
                            src={result.url}
                            alt={`封面 ${index + 1}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none'
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 无搜索结果时的提示 */}
          {searchResults.length === 0 && !selectedUrl && !searching && !searchError && (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              点击「搜索封面」开始查找
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2 flex-shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 mr-1.5" />取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving || !selectedUrl}
          >
            {saving
              ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />保存中...</>
              : <><Save className="w-4 h-4 mr-1.5" />确认保存</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 歌词搜索对话框 ───────────────────────────────────────────────────────────

/** 歌词搜索结果项 */
interface LyricSearchResult {
  id: string
  title: string
  artist: string
  album: string
  cover: string | null
  lrcText: string
}

interface LyricsSearchDialogProps {
  open: boolean
  onClose: () => void
  song: Song
  onSave: (lrcText: string) => Promise<void>
}

function LyricsSearchDialog({ open, onClose, song, onSave }: LyricsSearchDialogProps) {
  const { lyricsRemoteTemplate, apiAuthToken } = useSettingsStore()
  const previewRef = useRef<HTMLPreElement>(null)

  const [searchTitle, setSearchTitle] = useState(song.title)
  const [searchArtist, setSearchArtist] = useState(song.artist)
  const [searchAlbum, setSearchAlbum] = useState(song.album)

  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<LyricSearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [previewLrc, setPreviewLrc] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setSearchTitle(song.title)
      setSearchArtist(song.artist)
      setSearchAlbum(song.album)
      setSearchResults([])
      setSelectedIndex(0)
      setPreviewLrc(null)
      setSearchError(null)
      setSearching(false)
      setSaving(false)
    }
  }, [open, song])

  /** 解析 API 返回的歌词数据 */
  function parseLyricsFromResponse(text: string): LyricSearchResult[] {
    try {
      const json = JSON.parse(text)
      const list: unknown[] = Array.isArray(json) ? json : [json]
      const results: LyricSearchResult[] = []
      
      for (const item of list) {
        const record = item as Record<string, unknown>
        // 提取歌词文本，尝试多种常见字段名
        const lrcText = String(
          record?.lyrics ?? record?.o3ics ?? record?.lrc ?? record?.o3ic ?? record?.content ?? record?.text ?? ''
        )
        
        // 只有有内容的才添加
        if (lrcText && lrcText.trim()) {
          results.push({
            id: String(record?.id ?? results.length),
            title: String(record?.title ?? ''),
            artist: String(record?.artist ?? ''),
            album: String(record?.album ?? ''),
            cover: record?.cover != null ? String(record.cover) : null,
            lrcText,
          })
        }
      }
      
      return results
    } catch {
      // JSON 解析失败，尝试当作纯文本歌词处理
      if (text.trim()) {
        return [{
          id: '0',
          title: '',
          artist: '',
          album: '',
          cover: null,
          lrcText: text,
        }]
      }
      return []
    }
  }

  /**
   * 计算搜索结果与目标歌曲的匹配分数
   * 分数越高，匹配度越高
   */
  function calculateMatchScore(result: LyricSearchResult, targetTitle: string, targetArtist: string, targetAlbum: string): number {
    let score = 0
    const tTitle = targetTitle.toLowerCase().trim()
    const tArtist = targetArtist.toLowerCase().trim()
    const tAlbum = targetAlbum.toLowerCase().trim()
    const rTitle = result.title.toLowerCase().trim()
    const rArtist = result.artist.toLowerCase().trim()
    const rAlbum = result.album.toLowerCase().trim()

    // 标题完全匹配：+50 分
    if (rTitle === tTitle) {
      score += 50
    } else if (rTitle && tTitle) {
      // 标题包含匹配：+25 分
      if (rTitle.includes(tTitle) || tTitle.includes(rTitle)) {
        score += 25
      }
    }

    // 艺术家匹配：+30 分
    if (rArtist === tArtist) {
      score += 30
    } else if (rArtist && tArtist) {
      // 艺术家名称包含匹配（部分匹配）
      if (rArtist.includes(tArtist) || tArtist.includes(rArtist)) {
        score += 20
      } else {
        // 逐词匹配
        const tArtistWords = tArtist.split(/[\s,，、]/).filter(w => w.length >= 2)
        const rArtistWords = rArtist.split(/[\s,，、]/).filter(w => w.length >= 2)
        const matchedWords = tArtistWords.filter(w => rArtistWords.some(rw => rw.includes(w) || w.includes(rw)))
        score += matchedWords.length * 10
      }
    }

    // 专辑匹配：+15 分
    if (rAlbum === tAlbum) {
      score += 15
    } else if (rAlbum && tAlbum) {
      if (rAlbum.includes(tAlbum) || tAlbum.includes(rAlbum)) {
        score += 10
      }
    }

    // 歌词行数适中加分（太少可能不完整，太多可能有杂质）：+5 分
    const lineCount = result.lrcText.split('\n').filter(l => l.trim()).length
    if (lineCount >= 5 && lineCount <= 100) {
      score += 5
    }

    return score
  }

  /**
   * 从搜索结果中选择最佳匹配
   * 按照匹配度分数降序排列
   */
  function selectBestMatches(
    results: LyricSearchResult[],
    targetTitle: string,
    targetArtist: string,
    targetAlbum: string
  ): LyricSearchResult[] {
    // 计算每个结果的匹配分数
    const scored = results.map(result => ({
      result,
      score: calculateMatchScore(result, targetTitle, targetArtist, targetAlbum),
    }))

    // 按分数降序排列
    scored.sort((a, b) => b.score - a.score)

    // 返回排序后的结果
    return scored.map(s => s.result)
  }

  const handleSearch = async () => {
    if (!lyricsRemoteTemplate) {
      toast({ title: '请先在设置中配置自定义歌词 API', variant: 'destructive' })
      return
    }

    setSearching(true)
    setSearchError(null)
    setSearchResults([])
    setPreviewLrc(null)

    try {
      const url = new URL(lyricsRemoteTemplate)
      if (searchTitle)  url.searchParams.set('title', searchTitle)
      if (searchArtist) url.searchParams.set('artist', searchArtist)
      if (searchAlbum)  url.searchParams.set('album', searchAlbum)
      url.searchParams.set('offset', '0')
      url.searchParams.set('limit', '10')

      const headers: Record<string, string> = {}
      if (apiAuthToken) headers['Authorization'] = apiAuthToken

      const res = await fetch(url.toString(), { headers })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const text = await res.text()
      const results = parseLyricsFromResponse(text)

      if (results.length === 0) {
        setSearchError('未找到歌词，请尝试调整查询参数')
        return
      }

      // 按与原歌曲的匹配度排序
      const sortedResults = selectBestMatches(results, song.title, song.artist, song.album)

      setSearchResults(sortedResults)
      setSelectedIndex(0)
      setPreviewLrc(sortedResults[0].lrcText)
    } catch (err) {
      toast({
        title: '查询失败',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setSearching(false)
    }
  }

  /** 选择某个搜索结果 */
  const handleSelectResult = (index: number) => {
    setSelectedIndex(index)
    setPreviewLrc(searchResults[index].lrcText)
  }

  const handleConfirm = async () => {
    if (!previewLrc) return
    setSaving(true)
    try {
      await onSave(previewLrc)
      onClose()
    } catch (err) {
      toast({
        title: '保存失败',
        description: (err as Error).message,
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const selectedResult = searchResults[selectedIndex]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-2xl flex flex-col max-h-[85vh]"
        style={{ animation: 'none' }}
      >
        <DialogHeader>
          <DialogTitle>搜索歌词</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2 flex-1 overflow-hidden flex flex-col">
          <p className="text-xs text-muted-foreground flex-shrink-0">
            自定义查询参数，支持手动修改以获得更精确的搜索结果
          </p>

          <div className="space-y-2 flex-shrink-0">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">歌曲标题</label>
                <input
                  type="text"
                  value={searchTitle}
                  onChange={(e) => setSearchTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">歌手</label>
                <input
                  type="text"
                  value={searchArtist}
                  onChange={(e) => setSearchArtist(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">专辑</label>
                <input
                  type="text"
                  value={searchAlbum}
                  onChange={(e) => setSearchAlbum(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            <Button
              onClick={handleSearch}
              disabled={searching || !searchTitle.trim()}
              className="w-full"
              size="sm"
            >
              {searching
                ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />搜索中...</>
                : <><Search className="w-4 h-4 mr-1.5" />搜索歌词</>
              }
            </Button>
          </div>

          {searchError && (
            <p className="text-xs text-destructive px-1 flex-shrink-0">{searchError}</p>
          )}

          {/* 搜索结果列表：原生 overflow-y-auto，避免 Radix ScrollArea 在 flex 内无法收缩导致无法滚动 */}
          {searchResults.length > 0 && (
            <div className="flex-shrink-0 flex flex-col min-h-0">
              <p className="text-xs text-muted-foreground mb-1.5 flex-shrink-0">
                找到 {searchResults.length} 个结果，点击选择
              </p>
              <div
                className="mb-2 max-h-[min(15rem,32vh)] min-h-0 overflow-y-auto overscroll-y-contain rounded-lg border border-border/60 bg-muted/30"
                role="listbox"
                aria-label="歌词搜索结果"
              >
                <div className="p-2 space-y-1">
                  {searchResults.map((result, index) => (
                    <button
                      key={result.id}
                      type="button"
                      role="option"
                      aria-selected={selectedIndex === index}
                      onClick={() => handleSelectResult(index)}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-lg transition-colors text-sm',
                        selectedIndex === index
                          ? 'bg-primary/20 text-foreground'
                          : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          'w-5 h-5 rounded-full border flex items-center justify-center text-xs flex-shrink-0',
                          selectedIndex === index
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border'
                        )}>
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{result.title || '无标题'}</p>
                          {result.artist && (
                            <p className="text-xs truncate text-muted-foreground">
                              {result.artist}
                              {result.album && ` - ${result.album}`}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 歌词预览 */}
          {previewLrc !== null && (
            <div className="mt-2 flex-shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-muted-foreground">
                  歌词预览（{previewLrc.split('\n').filter(l => l.trim()).length} 行）
                  {selectedResult?.artist && (
                    <span className="ml-2">
                      - {selectedResult.artist}
                      {selectedResult.title && `《${selectedResult.title}》`}
                    </span>
                  )}
                </p>
                <span className="text-xs text-muted-foreground">可滚动查看</span>
              </div>
              <ScrollArea className="h-48 rounded-lg border border-border/60 bg-muted/30">
                <pre
                  ref={previewRef}
                  className="text-xs text-foreground/80 font-mono whitespace-pre-wrap leading-6 px-3 py-2"
                >
                  {previewLrc}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2 flex-shrink-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4 mr-1.5" />取消
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving || previewLrc === null}
          >
            {saving
              ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />保存中...</>
              : <><Save className="w-4 h-4 mr-1.5" />确认保存</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

type EditType = 'title' | 'album' | 'artist' | 'year' | 'genre' | 'track' | 'lyricsSearch' | 'coverSearch'

export default function SongDetailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const song = location.state?.song as Song | undefined
  const setFullscreen = usePlayerStore(s => s.setFullscreen)

  // ── 优先使用本地缓存的元信息 ────────────────────────────────────────────────
  const { getMergedSong } = useMetadataCacheStore()
  const mergedSong = song ? getMergedSong(song) : null
  const displaySong = mergedSong ?? song

  // ── 封面搜索相关 ────────────────────────────────────────────────────────────
  const { coverRemoteTemplate, apiAuthToken } = useSettingsStore()
  const { saveCover, getCover: getCachedCover } = useCoverCacheStore()
  const [coverSearchOpen, setCoverSearchOpen] = useState(false)
  const [searchedCover, setSearchedCover] = useState<string | null>(null)
  const [currentCoverUrl, setCurrentCoverUrl] = useState<string | null>(null)

  // 初始化当前封面 URL
  useEffect(() => {
    if (!song) return
    const cached = getCachedCover(song.id)
    if (cached) {
      setCurrentCoverUrl(cached)
    } else {
      setCurrentCoverUrl(null)
    }
  }, [song, getCachedCover])

  // ── 歌词保存相关 ────────────────────────────────────────────────────────────
  const { saveLyrics } = useLyricCacheStore()

  if (!displaySong) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
        <Music2 className="w-12 h-12 opacity-30" />
        <p className="text-sm">未找到歌曲信息</p>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-primary hover:underline"
        >
          返回
        </button>
      </div>
    )
  }

  // ── 保存元信息到本地缓存 ────────────────────────────────────────────────────
  const { saveMetadata } = useMetadataCacheStore()

  const handleSaveTitle = useCallback((newVal: string) => {
    saveMetadata(displaySong.id, { title: newVal })
    toast({ title: '标题已保存到本地缓存' })
    return Promise.resolve()
  }, [displaySong.id, saveMetadata])

  const handleSaveAlbum = useCallback((newVal: string) => {
    saveMetadata(displaySong.id, { album: newVal })
    toast({ title: '专辑已保存到本地缓存' })
    return Promise.resolve()
  }, [displaySong.id, saveMetadata])

  const handleSaveArtist = useCallback((newVal: string) => {
    saveMetadata(displaySong.id, { artist: newVal })
    toast({ title: '歌手已保存到本地缓存' })
    return Promise.resolve()
  }, [displaySong.id, saveMetadata])

  const handleSaveYear = useCallback((newVal: number) => {
    saveMetadata(displaySong.id, { year: newVal })
    toast({ title: '年代已保存到本地缓存' })
    return Promise.resolve()
  }, [displaySong.id, saveMetadata])

  const handleSaveGenre = useCallback((newVal: string) => {
    saveMetadata(displaySong.id, { genre: newVal })
    toast({ title: '流派已保存到本地缓存' })
    return Promise.resolve()
  }, [displaySong.id, saveMetadata])

  const handleSaveTrack = useCallback((newVal: number) => {
    saveMetadata(displaySong.id, { track: newVal })
    toast({ title: '音轨号已保存到本地缓存' })
    return Promise.resolve()
  }, [displaySong.id, saveMetadata])

  const handleLyricsSave = useCallback((lrcText: string) => {
    saveLyrics(displaySong.id, lrcText)
    toast({ title: '歌词已保存到本地缓存' })
    return Promise.resolve()
  }, [displaySong.id, saveLyrics])

  const handleCoverSave = useCallback((url: string) => {
    saveCover(displaySong.id, url)
    setCurrentCoverUrl(url)
    setCoverSearchOpen(false)
    setSearchedCover(null)
    toast({ title: '封面已保存到本地缓存' })
  }, [displaySong.id, saveCover])

  const contentTypeLabel = displaySong.contentType
    ? displaySong.contentType.split('/')[1]?.toLowerCase() ?? displaySong.contentType
    : undefined

  const [editType, setEditType] = useState<string | null>(null)

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold">歌曲详情</h1>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 max-w-2xl mx-auto">

          {/* 基础信息 */}
          <Section title="基础">
            {/* 封面行 */}
            <Row
              icon={<ImageIcon className="w-4 h-4" />}
              label="封面"
              value={currentCoverUrl ? '已设置自定义封面' : '服务器封面'}
              onClick={() => setCoverSearchOpen(true)}
              editable
              onEdit={() => setCoverSearchOpen(true)}
            />

            <Row
              icon={<Music2 className="w-4 h-4" />}
              label="标题"
              value={displaySong.title}
              editable
              onEdit={() => setEditType('title')}
            />

            <Row
              icon={<Disc3 className="w-4 h-4" />}
              label="专辑"
              value={displaySong.album}
              onClick={displaySong.albumId ? () => navigate(`/albums/${displaySong.albumId}`) : undefined}
              linkable={!!displaySong.albumId}
              editable
              onEdit={() => setEditType('album')}
            />

            <Row
              icon={<User className="w-4 h-4" />}
              label="专辑艺术家"
              value={displaySong.artist}
              onClick={displaySong.artistId ? () => navigate(`/artists/${displaySong.artistId}`) : undefined}
              linkable={!!displaySong.artistId}
              editable
              onEdit={() => setEditType('artist')}
            />

            <Row
              icon={<Users className="w-4 h-4" />}
              label="歌手"
              value={displaySong.artist}
              onClick={displaySong.artistId ? () => navigate(`/artists/${displaySong.artistId}`) : undefined}
              linkable={!!displaySong.artistId}
              editable
              onEdit={() => setEditType('artist')}
            />

            <Row
              icon={<AlignLeft className="w-4 h-4" />}
              label="歌词"
              value="查看 / 搜索歌词"
              onClick={() => { navigate(-1); setTimeout(() => setFullscreen(true), 50) }}
              linkable
            />

            <Row
              icon={<Search className="w-4 h-4" />}
              label="搜索歌词"
              value="自定义参数搜索"
              onClick={() => setEditType('o3icsSearch')}
            />

            <Row
              icon={<Calendar className="w-4 h-4" />}
              label="年代"
              value={displaySong.year ?? '-'}
              editable
              onEdit={() => setEditType('year')}
            />

            <Row
              icon={<Hash className="w-4 h-4" />}
              label="音轨号"
              value={displaySong.track ?? '-'}
              editable
              onEdit={() => setEditType('track')}
            />
          </Section>

          {/* 扩展信息 */}
          <Section title="扩展">
            {displaySong.path && (
              <Row
                icon={<FolderOpen className="w-4 h-4" />}
                label="文件路径"
                value={displaySong.path}
              />
            )}
            {displaySong.size != null && displaySong.size > 0 && (
              <Row
                icon={<HardDrive className="w-4 h-4" />}
                label="文件大小"
                value={formatFileSize(displaySong.size)}
              />
            )}
            {contentTypeLabel && (
              <Row
                icon={<FileAudio className="w-4 h-4" />}
                label="文件格式"
                value={contentTypeLabel}
              />
            )}
            {displaySong.duration > 0 && (
              <Row
                icon={<Clock className="w-4 h-4" />}
                label="时长"
                value={formatDuration(displaySong.duration)}
              />
            )}
            {displaySong.bitRate != null && displaySong.bitRate > 0 && (
              <Row
                icon={<Gauge className="w-4 h-4" />}
                label="比特率"
                value={`${displaySong.bitRate} kbps`}
              />
            )}
            {displaySong.playCount != null && displaySong.playCount > 0 && (
              <Row
                icon={<PlayCircle className="w-4 h-4" />}
                label="播放次数"
                value={displaySong.playCount}
              />
            )}
            <Row
              icon={<Layers className="w-4 h-4" />}
              label="流派"
              value={displaySong.genre ?? '-'}
              editable
              onEdit={() => setEditType('genre')}
            />
            {displaySong.userRating != null && displaySong.userRating > 0 && (
              <Row
                icon={<Timer className="w-4 h-4" />}
                label="评分"
                value={`${displaySong.userRating} / 5`}
              />
            )}
          </Section>

        </div>
      </ScrollArea>

      {/* 编辑标题 */}
      <EditFieldDialog
        open={editType === 'title'}
        onClose={() => setEditType(null)}
        title="编辑标题"
        label="歌曲标题"
        initialValue={displaySong.title}
        onSave={handleSaveTitle}
      />

      {/* 编辑专辑 */}
      <EditFieldDialog
        open={editType === 'album'}
        onClose={() => setEditType(null)}
        title="编辑专辑"
        label="专辑名称"
        initialValue={displaySong.album}
        onSave={handleSaveAlbum}
      />

      {/* 编辑歌手 */}
      <EditFieldDialog
        open={editType === 'artist'}
        onClose={() => setEditType(null)}
        title="编辑歌手"
        label="歌手名称"
        initialValue={displaySong.artist}
        onSave={handleSaveArtist}
      />

      {/* 编辑年代 */}
      <EditNumberDialog
        open={editType === 'year'}
        onClose={() => setEditType(null)}
        title="编辑年代"
        label="发行年份"
        initialValue={displaySong.year ?? null}
        onSave={handleSaveYear}
      />

      {/* 编辑流派 */}
      <EditFieldDialog
        open={editType === 'genre'}
        onClose={() => setEditType(null)}
        title="编辑流派"
        label="流派"
        initialValue={displaySong.genre ?? ''}
        placeholder="例如：Pop, Rock, Jazz"
        onSave={handleSaveGenre}
      />

      {/* 编辑音轨号 */}
      <EditNumberDialog
        open={editType === 'track'}
        onClose={() => setEditType(null)}
        title="编辑音轨号"
        label="音轨号"
        initialValue={displaySong.track ?? null}
        onSave={handleSaveTrack}
      />

      {/* 歌词搜索 */}
      <LyricsSearchDialog
        open={editType === 'o3icsSearch'}
        onClose={() => setEditType(null)}
        song={displaySong}
        onSave={handleLyricsSave}
      />

      {/* 封面搜索 */}
      <CoverSearchDialog
        open={coverSearchOpen}
        onClose={() => {
          setCoverSearchOpen(false)
          setSearchedCover(null)
        }}
        song={displaySong}
        initialCoverUrl={currentCoverUrl}
        onSave={handleCoverSave}
      />
    </div>
  )
}
