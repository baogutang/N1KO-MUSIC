/**
 * 歌曲详情页
 * - 通过 router state 传入 Song 对象（navigate('/songs/detail', { state: { song } })）
 * - 展示歌曲元信息；仅允许操作歌词（搜索/保存），其余信息只读
 */

import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronLeft,
  Music2, AlignLeft, FileAudio,
  HardDrive, Gauge, Clock, PlayCircle, Timer, FolderOpen,
  ArrowRight, Search,
  X, Save, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/use-toast'
import { useSettingsStore } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'
import { useLyricCacheStore } from '@/store/o3icCacheStore'
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
}

function Row({ icon, label, value, onClick, linkable }: RowProps) {
  const inner = (
    <>
      <div className="flex items-center gap-3 text-muted-foreground flex-shrink-0 w-36">
        <span className="flex-shrink-0">{icon}</span>
        <span className="text-sm text-foreground/80">{label}</span>
      </div>
      <div className="flex-1 text-right flex items-center justify-end gap-1 min-w-0">
        <span className="text-sm text-foreground/70 truncate text-right">{value}</span>
        {linkable && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
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
  const { o3icsRemoteTemplate, apiAuthToken } = useSettingsStore()
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
        const lrcText = String(
          record?.o3ics ?? record?.o3ics ?? record?.lrc ?? record?.o3ic ?? record?.content ?? record?.text ?? ''
        )

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
   */
  function calculateMatchScore(result: LyricSearchResult, targetTitle: string, targetArtist: string, targetAlbum: string): number {
    let score = 0
    const tTitle = targetTitle.toLowerCase().trim()
    const tArtist = targetArtist.toLowerCase().trim()
    const tAlbum = targetAlbum.toLowerCase().trim()
    const rTitle = result.title.toLowerCase().trim()
    const rArtist = result.artist.toLowerCase().trim()
    const rAlbum = result.album.toLowerCase().trim()

    if (rTitle === tTitle) score += 50
    else if (rTitle && tTitle && (rTitle.includes(tTitle) || tTitle.includes(rTitle))) score += 25

    if (rArtist === tArtist) score += 30
    else if (rArtist && tArtist) {
      if (rArtist.includes(tArtist) || tArtist.includes(rArtist)) score += 20
      else {
        const tWords = tArtist.split(/[\s,，、]/).filter(w => w.length >= 2)
        const rWords = rArtist.split(/[\s,，、]/).filter(w => w.length >= 2)
        score += tWords.filter(w => rWords.some(rw => rw.includes(w) || w.includes(rw))).length * 10
      }
    }

    if (rAlbum === tAlbum) score += 15
    else if (rAlbum && tAlbum && (rAlbum.includes(tAlbum) || tAlbum.includes(rAlbum))) score += 10

    const lineCount = result.lrcText.split('\n').filter(l => l.trim()).length
    if (lineCount >= 5 && lineCount <= 100) score += 5

    return score
  }

  function selectBestMatches(results: LyricSearchResult[], t: string, a: string, al: string): LyricSearchResult[] {
    return [...results]
      .map(r => ({ r, score: calculateMatchScore(r, t, a, al) }))
      .sort((a, b) => b.score - a.score)
      .map(s => s.r)
  }

  const handleSearch = async () => {
    if (!o3icsRemoteTemplate) {
      toast({ title: '请先在设置中配置自定义歌词 API', variant: 'destructive' })
      return
    }

    setSearching(true)
    setSearchError(null)
    setSearchResults([])
    setPreviewLrc(null)

    try {
      const url = new URL(o3icsRemoteTemplate)
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

      const sorted = selectBestMatches(results, song.title, song.artist, song.album)
      setSearchResults(sorted)
      setSelectedIndex(0)
      setPreviewLrc(sorted[0].lrcText)
    } catch (err) {
      toast({ title: '查询失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSearching(false)
    }
  }

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
      toast({ title: '保存失败', description: (err as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const selectedResult = searchResults[selectedIndex]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl flex flex-col max-h-[85vh]" style={{ animation: 'none' }}>
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
                  type="text" value={searchTitle}
                  onChange={(e) => setSearchTitle(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">歌手</label>
                <input
                  type="text" value={searchArtist}
                  onChange={(e) => setSearchArtist(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">专辑</label>
                <input
                  type="text" value={searchAlbum}
                  onChange={(e) => setSearchAlbum(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            <Button onClick={handleSearch} disabled={searching || !searchTitle.trim()} className="w-full" size="sm">
              {searching
                ? <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" />搜索中...</>
                : <><Search className="w-4 h-4 mr-1.5" />搜索歌词</>
              }
            </Button>
          </div>

          {searchError && <p className="text-xs text-destructive px-1 flex-shrink-0">{searchError}</p>}

          {searchResults.length > 0 && (
            <div className="flex-shrink-0 flex flex-col min-h-0">
              <p className="text-xs text-muted-foreground mb-1.5 flex-shrink-0">
                找到 {searchResults.length} 个结果，点击选择
              </p>
              <div
                className="mb-2 max-h-[min(15rem,32vh)] min-h-0 overflow-y-auto overscroll-y-contain rounded-lg border border-border/60 bg-muted/30"
                role="listbox" aria-label="歌词搜索结果"
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
                          selectedIndex === index ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                        )}>{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{result.title || '无标题'}</p>
                          {result.artist && (
                            <p className="text-xs truncate text-muted-foreground">
                              {result.artist}{result.album && ` - ${result.album}`}
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

          {previewLrc !== null && (
            <div className="mt-2 flex-shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-muted-foreground">
                  歌词预览（{previewLrc.split('\n').filter(l => l.trim()).length} 行）
                  {selectedResult?.artist && (
                    <span className="ml-2">
                      - {selectedResult.artist}{selectedResult.title && `《${selectedResult.title}》`}
                    </span>
                  )}
                </p>
                <span className="text-xs text-muted-foreground">可滚动查看</span>
              </div>
              <ScrollArea className="h-48 rounded-lg border border-border/60 bg-muted/30">
                <pre ref={previewRef} className="text-xs text-foreground/80 font-mono whitespace-pre-wrap leading-6 px-3 py-2">
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
          <Button onClick={handleConfirm} disabled={saving || previewLrc === null}>
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

export default function SongDetailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const song = location.state?.song as Song | undefined
  const setFullscreen = usePlayerStore(s => s.setFullscreen)
  const { saveLyrics } = useLyricCacheStore()

  const [o3icsSearchOpen, setO3icsSearchOpen] = useState(false)

  if (!song) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
        <Music2 className="w-12 h-12 opacity-30" />
        <p className="text-sm">未找到歌曲信息</p>
        <button onClick={() => navigate(-1)} className="text-sm text-primary hover:underline">
          返回
        </button>
      </div>
    )
  }

  const handleLyricsSave = async (lrcText: string) => {
    saveLyrics(song.id, lrcText)
    toast({ title: '歌词已保存到本地缓存' })
  }

  const contentTypeLabel = song.contentType
    ? song.contentType.split('/')[1]?.toLowerCase() ?? song.contentType
    : undefined

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
            <Row
              icon={<Music2 className="w-4 h-4" />}
              label="标题"
              value={song.title}
            />

            <Row
              icon={<AlignLeft className="w-4 h-4" />}
              label="专辑"
              value={song.album || '-'}
              onClick={song.albumId ? () => navigate(`/albums/${song.albumId}`) : undefined}
              linkable={!!song.albumId}
            />

            <Row
              icon={<AlignLeft className="w-4 h-4" />}
              label="歌手"
              value={song.artist || '-'}
              onClick={song.artistId ? () => navigate(`/artists/${song.artistId}`) : undefined}
              linkable={!!song.artistId}
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
              onClick={() => setO3icsSearchOpen(true)}
            />

            {song.year != null && (
              <Row
                icon={<AlignLeft className="w-4 h-4" />}
                label="年代"
                value={String(song.year)}
              />
            )}

            {song.track != null && (
              <Row
                icon={<AlignLeft className="w-4 h-4" />}
                label="音轨号"
                value={String(song.track)}
              />
            )}
          </Section>

          {/* 扩展信息 */}
          <Section title="扩展">
            {song.path && (
              <Row
                icon={<FolderOpen className="w-4 h-4" />}
                label="文件路径"
                value={song.path}
              />
            )}
            {song.size != null && song.size > 0 && (
              <Row
                icon={<HardDrive className="w-4 h-4" />}
                label="文件大小"
                value={formatFileSize(song.size)}
              />
            )}
            {contentTypeLabel && (
              <Row
                icon={<FileAudio className="w-4 h-4" />}
                label="文件格式"
                value={contentTypeLabel}
              />
            )}
            {song.duration > 0 && (
              <Row
                icon={<Clock className="w-4 h-4" />}
                label="时长"
                value={formatDuration(song.duration)}
              />
            )}
            {song.bitRate != null && song.bitRate > 0 && (
              <Row
                icon={<Gauge className="w-4 h-4" />}
                label="比特率"
                value={`${song.bitRate} kbps`}
              />
            )}
            {song.playCount != null && song.playCount > 0 && (
              <Row
                icon={<PlayCircle className="w-4 h-4" />}
                label="播放次数"
                value={song.playCount}
              />
            )}
            {song.genre && (
              <Row
                icon={<AlignLeft className="w-4 h-4" />}
                label="流派"
                value={song.genre}
              />
            )}
            {song.userRating != null && song.userRating > 0 && (
              <Row
                icon={<Timer className="w-4 h-4" />}
                label="评分"
                value={`${song.userRating} / 5`}
              />
            )}
          </Section>

        </div>
      </ScrollArea>

      {/* 歌词搜索 */}
      <LyricsSearchDialog
        open={o3icsSearchOpen}
        onClose={() => setO3icsSearchOpen(false)}
        song={song}
        onSave={handleLyricsSave}
      />
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
