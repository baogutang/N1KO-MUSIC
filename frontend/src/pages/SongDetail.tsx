/**
 * 歌曲详情页
 * - 通过 router state 传入 Song 对象（navigate('/songs/detail', { state: { song } })）
 * - 展示歌曲元信息；仅允许操作歌词（搜索/保存），其余信息只读
 * 杂志编辑风（DESIGN v2）：「档案表」范式——衬线曲名 + 分组发丝线 definition rows。
 */

import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  MusicNote, ArrowRight, MagnifyingGlass,
  X, FloppyDisk, ArrowsClockwise,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/use-toast'
import { useSettingsStore, buildRemoteCoverUrl } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'
import { useLyricCacheStore } from '@/store/lyricCacheStore'
import { SongCredits } from '@/components/music/LinerNotes'
import { buildSpecLine } from '@/utils/audioSpec'
import { useCoverCacheStore } from '@/store/coverCacheStore'
import { usePinnedCover } from '@/hooks/useCoverUrl'
import { useSongDetail } from '@/hooks/useServerQueries'
import { getAdapter, hasAdapter } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { formatDuration, formatFileSize } from '@/utils/formatters'
import type { Song } from '@/api/types'
import { spaceCJK } from '@/utils/cjkTypography'
import { MarginNote } from '@/components/music/MarginNote'

// ─── 子组件 ───────────────────────────────────────────────────────────────────

/** 档案分组：衬线标题 + 拉丁小标签 + 下缘发丝线 */
function Section({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between border-b border-hair pb-2.5">
        <h2 className="font-serif text-xl font-semibold">{title}</h2>
        <span className="text-[10px] tracking-[0.24em] text-ink-faint">{tag}</span>
      </div>
      <dl className="divide-y divide-hair-soft">
        {children}
      </dl>
    </section>
  )
}

interface RowProps {
  label: string
  value: React.ReactNode
  /** 数字/元数据值用等宽 tabular */
  mono?: boolean
  onClick?: () => void
  linkable?: boolean
}

/** 档案行：左 ink-faint 小标签（wide-tracking），右值 */
function Row({ label, value, mono, onClick, linkable }: RowProps) {
  const inner = (
    <>
      <dt className="w-28 flex-shrink-0 text-[11px] tracking-[0.2em] text-ink-faint">{label}</dt>
      <dd className="flex-1 min-w-0 flex items-center justify-end gap-1.5 text-right">
        <span
          className={cn(
            'text-sm truncate',
            mono && 'num',
            onClick && 'group-hover:text-primary group-hover:underline decoration-hair underline-offset-[6px]'
          )}
        >
          {value}
        </span>
        {linkable && <ArrowRight className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" />}
      </dd>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="group w-full flex items-center gap-4 py-3.5 text-left">
        {inner}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-4 py-3.5">
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
  /** 与目标歌曲的匹配分（排序后写入，仅用于展示） */
  score?: number
}

/** 从 LRC 文本时间戳估计时长（秒），无时间戳返回 null */
function lrcDurationSeconds(lrc: string): number | null {
  let max = 0
  const re = /\[(\d{1,3}):(\d{1,2})(?:[.:]\d{1,3})?\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lrc))) {
    const s = Number(m[1]) * 60 + Number(m[2])
    if (s > max) max = s
  }
  return max > 0 ? max : null
}

/** 与目标歌曲时长的差值，格式 ±m:ss */
function formatDurationDiff(targetSeconds: number, lrc: string): string {
  const lrcSeconds = lrcDurationSeconds(lrc)
  if (lrcSeconds === null || !targetSeconds) return '--'
  const diff = Math.abs(lrcSeconds - targetSeconds)
  return `±${Math.floor(diff / 60)}:${String(Math.floor(diff % 60)).padStart(2, '0')}`
}

interface LyricsSearchDialogProps {
  open: boolean
  onClose: () => void
  song: Song
  onSave: (lrcText: string) => Promise<void>
}

function LyricsSearchDialog({ open, onClose, song, onSave }: LyricsSearchDialogProps) {
  const lyricsRemoteTemplate = useSettingsStore(s => s.lyricsRemoteTemplate)
  const apiAuthToken = useSettingsStore(s => s.apiAuthToken)
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
        // 与 useLyricsQuery 远程解析保持一致：常见字段名 lyrics / lyric / lrc 等
        const lrcText = String(
          record?.lyrics ??
            record?.lyric ??
            record?.lrc ??
            record?.content ??
            record?.text ??
            ''
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
      .map(r => ({ ...r, score: calculateMatchScore(r, t, a, al) }))
      .sort((a, b) => b.score - a.score)
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

        <div className="space-y-4 py-2 flex-1 overflow-hidden flex flex-col">
          <p className="text-xs text-ink-faint flex-shrink-0">
            自定义查询参数，支持手动修改以获得更精确的搜索结果
          </p>

          <div className="flex-shrink-0">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-[11px] tracking-[0.2em] text-ink-faint mb-1.5 block">歌曲标题</label>
                <Input
                  type="text" value={searchTitle}
                  onChange={(e) => setSearchTitle(e.target.value)}
                  className="h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm focus-visible:border-primary"
                />
              </div>
              <div>
                <label className="text-[11px] tracking-[0.2em] text-ink-faint mb-1.5 block">歌手</label>
                <Input
                  type="text" value={searchArtist}
                  onChange={(e) => setSearchArtist(e.target.value)}
                  className="h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm focus-visible:border-primary"
                />
              </div>
              <div>
                <label className="text-[11px] tracking-[0.2em] text-ink-faint mb-1.5 block">专辑</label>
                <Input
                  type="text" value={searchAlbum}
                  onChange={(e) => setSearchAlbum(e.target.value)}
                  className="h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm focus-visible:border-primary"
                />
              </div>
            </div>

            <Button
              type="button"
              onClick={handleSearch}
              disabled={searching || !searchTitle.trim()}
              className="mt-4 gap-1.5 px-0"
            >
              {searching
                ? <><ArrowsClockwise className="w-4 h-4 animate-spin" />搜索中…</>
                : <><MagnifyingGlass className="w-4 h-4" />搜索歌词</>
              }
            </Button>
          </div>

          {searchError && <p className="text-xs text-destructive flex-shrink-0">{searchError}</p>}

          {searchResults.length > 0 && (
            <div className="flex-shrink-0 flex flex-col min-h-0">
              <div className="flex items-baseline justify-between mb-2 flex-shrink-0">
                <p className="text-xs text-ink-faint">
                  找到 <span className="num">{searchResults.length}</span> 个结果，点击选择
                </p>
                <p className="text-[10px] tracking-[0.18em] text-ink-faint">匹配分 · 时长差</p>
              </div>
              <div
                className="mb-2 max-h-[min(15rem,32vh)] min-h-0 overflow-y-auto overscroll-y-contain border-y border-hair divide-y divide-hair-soft"
                role="listbox" aria-label="歌词搜索结果"
              >
                {searchResults.map((result, index) => (
                  <button
                    key={`${result.id}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selectedIndex === index}
                    onClick={() => handleSelectResult(index)}
                    className={cn(
                      'w-full text-left px-3 py-2.5 border-l-2 transition-colors duration-150',
                      selectedIndex === index
                        ? 'border-primary bg-paper-deep/60'
                        : 'border-transparent hover:bg-paper-deep/40'
                    )}
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="num w-5 flex-shrink-0 text-[11px] text-ink-faint">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-serif text-[15px] font-semibold">{result.title || '无标题'}</p>
                        <p className="text-xs text-ink-faint truncate mt-0.5">
                          {result.artist || '未知歌手'}{result.album && ` · ${result.album}`}
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className={cn('num text-xs', selectedIndex === index ? 'text-primary' : 'text-ink-soft')}>
                          {result.score ?? 0} 分
                        </p>
                        <p className="num text-[11px] text-ink-faint mt-0.5">
                          {formatDurationDiff(song.duration, result.lrcText)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {previewLrc !== null && (
            <div className="mt-1 flex-shrink-0">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs text-ink-faint">
                  歌词预览（<span className="num">{previewLrc.split('\n').filter(l => l.trim()).length}</span> 行）
                  {selectedResult?.artist && (
                    <span className="ml-2">
                      — {selectedResult.artist}{selectedResult.title && `《${selectedResult.title}》`}
                    </span>
                  )}
                </p>
                <span className="text-[10px] tracking-[0.18em] text-ink-faint">可滚动查看</span>
              </div>
              <ScrollArea className="h-48 rounded-sm border border-hair">
                <pre ref={previewRef} className="num text-xs text-ink-soft whitespace-pre-wrap leading-6 px-3 py-2">
                  {previewLrc}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="flex justify-end items-center gap-5 mt-2 flex-shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={saving} className="gap-1.5 px-0">
            <X className="w-4 h-4" />取消
          </Button>
          <Button onClick={handleConfirm} disabled={saving || previewLrc === null} className="gap-1.5 px-0">
            {saving
              ? <><ArrowsClockwise className="w-4 h-4 animate-spin" />保存中…</>
              : <><FloppyDisk className="w-4 h-4" />确认保存</>
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 封面选择对话框 ───────────────────────────────────────────────────────────

interface CoverPickerDialogProps {
  open: boolean
  onClose: () => void
  song: Song
  pinnedUrl: string | null
  onSave: (url: string) => void
  onClear: () => void
}

/**
 * 为单曲钉住一张本地封面。
 *
 * 与歌词不同，自定义封面接口是「模板 URL 直接返回图片」而非返回候选列表，
 * 因此这里的做法是：按可编辑的元数据拼出 URL（或直接粘贴图片地址）→ 预览确认 → 保存。
 * 仅在图片确实加载成功后才允许保存，避免把坏链接钉死在歌曲上。
 */
function CoverPickerDialog({ open, onClose, song, pinnedUrl, onSave, onClear }: CoverPickerDialogProps) {
  const coverRemoteTemplate = useSettingsStore(s => s.coverRemoteTemplate)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [album, setAlbum] = useState('')
  const [directUrl, setDirectUrl] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  /** 同一 URL 重复预览时用于强制重建 <img>，否则 onLoad 不会再触发 */
  const [attempt, setAttempt] = useState(0)

  // 每次打开都回到当前歌曲的元数据，避免残留上一首的编辑内容
  useEffect(() => {
    if (!open) return
    setTitle(song.title ?? '')
    setArtist(song.artist ?? '')
    setAlbum(song.album ?? '')
    setDirectUrl('')
    setPreviewUrl(null)
    setStatus('idle')
  }, [open, song.id, song.title, song.artist, song.album])

  // 预览成功后又改了参数：必须重新预览，否则「确认保存」会存下上一张图
  useEffect(() => {
    setPreviewUrl(null)
    setStatus('idle')
  }, [title, artist, album, directUrl])

  const trimmedDirect = directUrl.trim()
  const templateUrl = coverRemoteTemplate
    ? buildRemoteCoverUrl(coverRemoteTemplate, { title, artist, album, id: song.id })
    : ''
  // 直接粘贴的地址优先于模板拼接
  const resolvedUrl = trimmedDirect || templateUrl

  const handlePreview = () => {
    if (!resolvedUrl) return
    setPreviewUrl(resolvedUrl)
    setStatus('loading')
    setAttempt(value => value + 1)
  }

  const handleConfirm = () => {
    if (status !== 'ok' || !previewUrl) return
    onSave(previewUrl)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl flex flex-col max-h-[85vh]" style={{ animation: 'none' }}>
        <DialogHeader>
          <DialogTitle>设置本地封面</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 overflow-y-auto">
          <p className="text-xs text-ink-faint">
            钉住的封面只保存在本机，优先级高于服务器封面与「封面来源」设置。
          </p>

          {coverRemoteTemplate ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-[11px] tracking-[0.2em] text-ink-faint mb-1.5 block">歌曲标题</label>
                <Input
                  type="text" value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm focus-visible:border-primary"
                />
              </div>
              <div>
                <label className="text-[11px] tracking-[0.2em] text-ink-faint mb-1.5 block">歌手</label>
                <Input
                  type="text" value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm focus-visible:border-primary"
                />
              </div>
              <div>
                <label className="text-[11px] tracking-[0.2em] text-ink-faint mb-1.5 block">专辑</label>
                <Input
                  type="text" value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  className="h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm focus-visible:border-primary"
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-soft">
              未配置自定义封面接口，可在「设置 · 封面」里填写模板，或在下方直接粘贴图片地址。
            </p>
          )}

          <div>
            <label className="text-[11px] tracking-[0.2em] text-ink-faint mb-1.5 block">图片地址</label>
            <Input
              type="url" value={directUrl} placeholder={templateUrl || 'https://…'}
              onChange={(e) => setDirectUrl(e.target.value)}
              className="h-9 rounded-none border-0 border-b border-hair bg-transparent px-0 text-sm focus-visible:border-primary"
            />
          </div>

          <Button
            type="button"
            onClick={handlePreview}
            disabled={!resolvedUrl || status === 'loading'}
            className="gap-1.5 px-0"
          >
            {status === 'loading'
              ? <><ArrowsClockwise className="w-4 h-4 animate-spin" />加载中…</>
              : <><MagnifyingGlass className="w-4 h-4" />预览封面</>
            }
          </Button>

          {status === 'error' && (
            <p className="text-xs text-destructive">图片加载失败，请检查地址或调整查询参数。</p>
          )}

          {previewUrl && (
            <div>
              <p className="text-xs text-ink-faint mb-2">预览</p>
              <div className="w-40 h-40 rounded-md ring-1 ring-hair overflow-hidden bg-paper-deep">
                {/* 用原生 img 直接验证可加载性，不走 ImageWithFallback 的多来源合并 */}
                <img
                  key={`${previewUrl}#${attempt}`}
                  src={previewUrl}
                  alt="封面预览"
                  className={cn('w-full h-full object-cover', status !== 'ok' && 'opacity-0')}
                  onLoad={() => setStatus('ok')}
                  onError={() => setStatus('error')}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center gap-5 mt-2 flex-shrink-0">
          {pinnedUrl ? (
            <Button
              variant="ghost"
              onClick={() => { onClear(); onClose() }}
              className="gap-1.5 px-0 text-destructive hover:text-destructive"
            >
              <X className="w-4 h-4" />移除本地封面
            </Button>
          ) : <span />}
          <div className="flex items-center gap-5">
            <Button variant="ghost" onClick={onClose} className="gap-1.5 px-0">
              <X className="w-4 h-4" />取消
            </Button>
            <Button onClick={handleConfirm} disabled={status !== 'ok'} className="gap-1.5 px-0">
              <FloppyDisk className="w-4 h-4" />确认保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function SongDetailPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const stateSong = location.state?.song as Song | undefined
  const { data: fetchedSong, isLoading, isError } = useSongDetail(id ?? '', stateSong)
  const song = fetchedSong ?? stateSong
  const setFullscreen = usePlayerStore(s => s.setFullscreen)
  const { saveLyrics } = useLyricCacheStore()
  const saveCover = useCoverCacheStore(s => s.saveCover)
  const removeCover = useCoverCacheStore(s => s.removeCover)
  const pinnedCover = usePinnedCover(song?.id)

  const [lyricsSearchOpen, setLyricsSearchOpen] = useState(false)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)

  if (isLoading && !song) {
    return (
      <div className="pt-9 pb-8 max-w-[720px] animate-fade-in">
        <div className="h-3 w-20 bg-hair-soft rounded-sm animate-pulse" />
        <div className="h-10 w-2/3 bg-hair-soft rounded-sm animate-pulse mt-5" />
        <div className="mt-14 space-y-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 bg-hair-soft rounded-sm animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!song || isError) {
    return (
      <div className="pt-24 max-w-[720px] animate-fade-in">
        <MusicNote className="w-8 h-8 text-ink-faint mb-5" />
        <p className="font-serif text-2xl font-semibold">未找到歌曲信息。</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 text-sm text-primary underline decoration-hair underline-offset-[6px] hover:decoration-primary transition-colors"
        >
          返回上一页
        </button>
      </div>
    )
  }

  const handleLyricsSave = async (lrcText: string) => {
    saveLyrics(song.id, lrcText)
    toast({ title: '歌词已保存到本地缓存' })
  }

  const handleCoverSave = (url: string) => {
    saveCover(song.id, url)
    toast({ title: '封面已钉在本地' })
  }

  const handleCoverClear = () => {
    removeCover(song.id)
    toast({ title: '已移除本地封面' })
  }

  const specLine = buildSpecLine(song)
  const contentTypeLabel = song.contentType
    ? song.contentType.split('/')[1]?.toLowerCase() ?? song.contentType
    : undefined

  return (
    <div className="animate-fade-in">
      <div className="pt-9 pb-8 max-w-[720px]">

        {/* 报头：封面 + 衬线曲名 */}
        <div className="flex items-start gap-7">
          <div className="w-36 h-36 rounded-md ring-1 ring-hair overflow-hidden flex-shrink-0 shadow-float bg-paper-deep">
            <ImageWithFallback
              src={song.coverArt && hasAdapter() ? getAdapter().getCoverUrl(song.coverArt, 300) : undefined}
              alt={song.title}
              fallbackType="album"
              className="w-full h-full"
              songId={song.id}
              customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
            />
          </div>
          <div className="min-w-0 pt-1">
            <p className="text-[11px] tracking-[0.3em] text-ink-faint mb-2.5">歌曲 · TRACK</p>
            <h1 className="font-serif text-4xl font-black tracking-tight leading-tight text-balance">{spaceCJK(song.title)}</h1>
            <p className="text-sm text-ink-soft mt-3 truncate">
              {spaceCJK(song.artist)}
              {song.album && ` · ${song.album}`}
            </p>
          </div>
        </div>

        {/* 边注：先于所有服务器给的字段——这一条是你写的，其余都是别人写的 */}
        <MarginNote target="song" targetId={song.id} className="mt-10 max-w-[38em]" />

        {/* 基础信息 */}
        <Section title="基础" tag="BASIC">
          <Row label="标题" value={song.title} />

          <Row
            label="专辑"
            value={song.album || '—'}
            onClick={song.albumId ? () => navigate(`/albums/${song.albumId}`) : undefined}
            linkable={!!song.albumId}
          />

          <Row
            label="歌手"
            value={song.artist || '—'}
            onClick={song.artistId ? () => navigate(`/artists/${song.artistId}`) : undefined}
            linkable={!!song.artistId}
          />

          <Row
            label="歌词"
            value="查看 / 搜索歌词"
            onClick={() => { navigate(-1); setTimeout(() => setFullscreen(true), 50) }}
            linkable
          />

          <Row
            label="搜索歌词"
            value="自定义参数搜索"
            onClick={() => setLyricsSearchOpen(true)}
            linkable
          />

          <Row
            label="本地封面"
            value={pinnedCover ? '已钉住 · 点击更换' : '设置本地封面'}
            onClick={() => setCoverPickerOpen(true)}
            linkable
          />

          {song.year != null && (
            <Row label="年代" value={String(song.year)} mono />
          )}

          {song.track != null && (
            <Row label="音轨号" value={String(song.track)} mono />
          )}
        </Section>

        {/* 扩展信息 */}
        <Section title="扩展" tag="FILE">
          {song.path && (
            <Row label="文件路径" value={song.path} />
          )}
          {song.size != null && song.size > 0 && (
            <Row label="文件大小" value={formatFileSize(song.size)} mono />
          )}
          {contentTypeLabel && (
            <Row label="文件格式" value={contentTypeLabel} />
          )}
          {song.duration > 0 && (
            <Row label="时长" value={formatDuration(song.duration)} mono />
          )}
          {song.bitRate != null && song.bitRate > 0 && (
            <Row label="比特率" value={`${song.bitRate} kbps`} mono />
          )}
          {song.playCount != null && song.playCount > 0 && (
            <Row label="播放次数" value={song.playCount} mono />
          )}
          {song.genre && (
            <Row label="流派" value={song.genre} />
          )}
          {song.userRating != null && song.userRating > 0 && (
            <Row label="评分" value={`${song.userRating} / 5`} mono />
          )}
        </Section>

        {/* 规格铭牌：服务器早就返回这些字段，此前被 mapSong 一律丢弃 */}
        {specLine.length > 0 && (
          <Section title="规格" tag="SPEC">
            <Row label="音频规格" value={specLine.join(' · ')} mono />
            {song.ext?.bpm ? <Row label="BPM" value={String(song.ext.bpm)} mono /> : null}
            {song.ext?.moods?.length ? (
              <Row label="情绪" value={song.ext.moods.join(' · ')} />
            ) : null}
            {song.ext?.isrc?.length ? (
              <Row label="ISRC" value={song.ext.isrc.join(' · ')} mono />
            ) : null}
            {song.ext?.musicBrainzId ? (
              <Row label="MusicBrainz" value={song.ext.musicBrainzId} mono />
            ) : null}
          </Section>
        )}

        {/* 制作人员 */}
        {(song.ext?.contributors?.length || song.ext?.displayComposer) && (
          <Section title="制作" tag="CREDITS">
            <SongCredits
              contributors={song.ext?.contributors}
              composer={song.ext?.displayComposer}
            />
          </Section>
        )}

      </div>

      {/* 歌词搜索 */}
      <LyricsSearchDialog
        open={lyricsSearchOpen}
        onClose={() => setLyricsSearchOpen(false)}
        song={song}
        onSave={handleLyricsSave}
      />

      {/* 本地封面 */}
      <CoverPickerDialog
        open={coverPickerOpen}
        onClose={() => setCoverPickerOpen(false)}
        song={song}
        pinnedUrl={pinnedCover}
        onSave={handleCoverSave}
        onClear={handleCoverClear}
      />
    </div>
  )
}
