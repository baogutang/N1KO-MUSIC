/**
 * 歌曲详情页
 * - 地址是 `/songs/:id?src=<serverId>`：`?src=` 指明这首歌属于**哪个音源**
 *   （SongList 的「查看详情」已经带上）。router state 里的 Song 只是首屏加速，
 *   直接刷新或从分享链接进来时没有 state，这一页要靠 `?src=` 自己查得回来。
 * - 展示歌曲元信息；仅允许操作歌词（搜索/保存），其余信息只读
 * 舞台光版式（v6）：头部是 DetailHero（封面带着自己的光、从点开的卡片飞过来、往下滚时收小），
 * 副标题是歌手 / 专辑链接，元信息的第一项是音源，动作行一枚青柠主键；
 * 其下是几块 sheet（基础 / 文件 / 规格 / 制作）的 definition rows；
 * 歌词在对话框里的一块安静面板上读。
 */

import { useState, useRef, useEffect } from 'react'
import { describeError, pluginErrorCode } from '@/services/errors'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  MagnifyingGlass, TextAlignLeft, ImageSquare, ShareNetwork,
  X, FloppyDisk, ArrowsClockwise,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ErrorState } from '@/components/common/ErrorState'
import { EmptyState } from '@/components/common/EmptyState'
import { DetailHero } from '@/components/common/DetailHero'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/use-toast'
import { useSettingsStore, buildRemoteCoverUrl } from '@/store/settingsStore'
import { usePlayerStore } from '@/store/playerStore'
import { useLyricCacheStore } from '@/store/lyricCacheStore'
import { artistKey, normalizeText, titleKey } from '@/utils/songIdentity'
import { SongCredits } from '@/components/music/LinerNotes'
import { buildSpecLine } from '@/utils/audioSpec'
import { useCoverCacheStore } from '@/store/coverCacheStore'
import { usePinnedCover } from '@/hooks/useCoverUrl'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { useLyricsQuery } from '@/hooks/useServerQueries'
import { useServerStore } from '@/store/serverStore'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { findAdapterFor, getAdapterFor, hasAdapterFor } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { formatDuration, formatFileSize } from '@/utils/formatters'
import type { Song } from '@/api/types'
import { spaceCJK } from '@/utils/cjkTypography'
import { MarginNote } from '@/components/music/MarginNote'
import { ShareDialog } from '@/components/music/ShareDialog'
import { LyricDisplay } from '@/components/player/LyricDisplay'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'
import { detailPath } from '@/utils/detailPath'

// ─── 子组件 ───────────────────────────────────────────────────────────────────

/** 信息分组：一块 sheet，Geologica 小标题 + definition rows，靠行距分隔，不画线 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="sheet p-5 regular:p-6">
      <h2 className="font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h2>
      <dl className="mt-2">
        {children}
      </dl>
    </section>
  )
}

interface RowProps {
  label: string
  value: React.ReactNode
  /** 数字/元数据值用 tabular 数字 */
  tabular?: boolean
}

/** 档案行：左 ink-3 说明，右值。值是字符串 / 数字时单行截断，其余（多段元信息）自己换行 */
function Row({ label, value, tabular }: RowProps) {
  const plain = typeof value === 'string' || typeof value === 'number'
  return (
    <div className="flex items-baseline gap-4 py-2.5">
      <dt className="w-28 flex-shrink-0 text-[14px] text-ink-3">{label}</dt>
      <dd className={cn('m-0 min-w-0 flex-1 text-right text-[15px] text-ink', tabular && 'num', plain && 'truncate')}>
        {value}
      </dd>
    </div>
  )
}

/** 一组并列的短值：独立 span、gap-x-3 换行，不用中点串联 */
function Spans({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap justify-end gap-x-3">
      {items.map((item, i) => <span key={`${i}-${item}`}>{item}</span>)}
    </span>
  )
}

const LABEL_CLS = 'mb-1.5 block text-[13px] font-medium text-ink-2'

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
  const { t } = useT()
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
    // 归一化走统一的 songIdentity（阶段 4.1）：全半角/标点差异不再当不同歌
    const tTitle = titleKey(targetTitle)
    const tArtist = artistKey(targetArtist)
    const tAlbum = normalizeText(targetAlbum)
    const rTitle = titleKey(result.title)
    const rArtist = artistKey(result.artist)
    const rAlbum = normalizeText(result.album)

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

  function selectBestMatches(
    results: LyricSearchResult[],
    targetTitle: string,
    targetArtist: string,
    targetAlbum: string,
  ): LyricSearchResult[] {
    return [...results]
      .map(r => ({ ...r, score: calculateMatchScore(r, targetTitle, targetArtist, targetAlbum) }))
      .sort((a, b) => b.score - a.score)
  }

  const handleSearch = async () => {
    if (!lyricsRemoteTemplate) {
      toast({ title: t('lyrics.needApiConfig'), variant: 'destructive' })
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
        setSearchError(t('lyrics.noResult'))
        return
      }

      const sorted = selectBestMatches(results, song.title, song.artist, song.album)
      setSearchResults(sorted)
      setSelectedIndex(0)
      setPreviewLrc(sorted[0].lrcText)
    } catch (err) {
      toast({ title: t('lyrics.searchFailed'), description: describeError(err), variant: 'destructive' })
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
      toast({ title: t('lyrics.saveFailed'), description: describeError(err), variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const selectedResult = searchResults[selectedIndex]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col regular:max-w-2xl" style={{ animation: 'none' }}>
        <DialogHeader>
          <DialogTitle>{t('lyrics.search')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 overflow-y-auto flex flex-col">
          <p className="text-[13px] text-ink-3 flex-shrink-0">
            {t('lyrics.searchHint')}
          </p>

          <div className="flex-shrink-0">
            <div className="grid grid-cols-1 gap-3 regular:grid-cols-3 regular:gap-4">
              <div>
                <label htmlFor="lyrics-search-title" className={LABEL_CLS}>{t('song.field.songTitle')}</label>
                <Input
                  id="lyrics-search-title"
                  type="text" value={searchTitle}
                  onChange={(e) => setSearchTitle(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="lyrics-search-artist" className={LABEL_CLS}>{t('song.field.artist')}</label>
                <Input
                  id="lyrics-search-artist"
                  type="text" value={searchArtist}
                  onChange={(e) => setSearchArtist(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="lyrics-search-album" className={LABEL_CLS}>{t('song.field.album')}</label>
                <Input
                  id="lyrics-search-album"
                  type="text" value={searchAlbum}
                  onChange={(e) => setSearchAlbum(e.target.value)}
                />
              </div>
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={handleSearch}
              disabled={searching || !searchTitle.trim()}
              className="mt-4"
            >
              {searching
                ? <><ArrowsClockwise className="w-4 h-4 animate-spin motion-reduce:animate-none" />{t('action.searching')}</>
                : <><MagnifyingGlass className="w-4 h-4" />{t('lyrics.search')}</>
              }
            </Button>
          </div>

          {searchError && <p className="text-[13px] text-danger flex-shrink-0">{searchError}</p>}

          {searchResults.length > 0 && (
            <div className="flex-shrink-0 flex flex-col min-h-0">
              <div className="flex items-baseline justify-between mb-2 flex-shrink-0">
                <p className="text-[13px] text-ink-3">
                  <span className="num">{t('lyrics.resultCount', { count: searchResults.length })}</span>
                </p>
                <p className="text-[12px] text-ink-3">{t('lyrics.scoreAndDelta')}</p>
              </div>
              <div
                className="mb-2 max-h-[min(15rem,32vh)] min-h-0 overflow-y-auto overscroll-y-contain space-y-1"
                role="listbox" aria-label={t('lyrics.resultsList')}
              >
                {searchResults.map((result, index) => (
                  <button
                    key={`${result.id}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selectedIndex === index}
                    onClick={() => handleSelectResult(index)}
                    className={cn(
                      'min-h-11 w-full rounded-sm px-3 py-2.5 text-left transition-colors duration-2',
                      selectedIndex === index
                        ? 'bg-ink/[0.08]'
                        : 'hover:bg-ink/[0.05]'
                    )}
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="num w-5 flex-shrink-0 text-[12px] text-ink-3">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold text-ink">{result.title || t('song.untitled')}</p>
                        <p className="mt-0.5 flex gap-x-3 text-[13px] text-ink-3">
                          <span className="truncate">{result.artist || t('song.unknownArtist')}</span>
                          {result.album && <span className="truncate">{result.album}</span>}
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className={cn('num text-[13px]', selectedIndex === index ? 'text-leaf' : 'text-ink-2')}>
                          {t('lyrics.scoreValue', { score: result.score ?? 0 })}
                        </p>
                        <p className="num mt-0.5 text-[12px] text-ink-3">
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
                <p className="text-[13px] text-ink-3">
                  {t('lyrics.previewLines', { count: previewLrc.split('\n').filter(l => l.trim()).length })}
                  {selectedResult?.artist && (
                    <span className="ml-2">
                      {selectedResult.title
                        ? t('lyrics.previewSourceFull', { artist: selectedResult.artist, title: selectedResult.title })
                        : t('lyrics.previewSource', { artist: selectedResult.artist })}
                    </span>
                  )}
                </p>
                <span className="text-[12px] text-ink-3">{t('lyrics.scrollHint')}</span>
              </div>
              <ScrollArea className="h-48 rounded-md bg-surface-2">
                <pre ref={previewRef} className="num text-[13px] text-ink-2 whitespace-pre-wrap leading-6 px-3 py-2">
                  {previewLrc}
                </pre>
              </ScrollArea>
            </div>
          )}
        </div>

        <div className="flex justify-end items-center gap-3 mt-2 flex-shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            <X className="w-4 h-4" />{t('action.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={saving || previewLrc === null}>
            {saving
              ? <><ArrowsClockwise className="w-4 h-4 animate-spin motion-reduce:animate-none" />{t('action.saving')}</>
              : <><FloppyDisk className="w-4 h-4" />{t('action.confirmSave')}</>
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
  const { t } = useT()
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
      <DialogContent className="flex max-h-[85vh] flex-col regular:max-w-xl" style={{ animation: 'none' }}>
        <DialogHeader>
          <DialogTitle>{t('song.cover.setLocal')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 overflow-y-auto">
          <p className="text-[13px] text-ink-3">
            {t('song.cover.localOnlyHint')}
          </p>

          {coverRemoteTemplate ? (
            <div className="grid grid-cols-1 gap-3 regular:grid-cols-3 regular:gap-4">
              <div>
                <label htmlFor="cover-pick-title" className={LABEL_CLS}>{t('song.field.songTitle')}</label>
                <Input
                  id="cover-pick-title"
                  type="text" value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="cover-pick-artist" className={LABEL_CLS}>{t('song.field.artist')}</label>
                <Input
                  id="cover-pick-artist"
                  type="text" value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="cover-pick-album" className={LABEL_CLS}>{t('song.field.album')}</label>
                <Input
                  id="cover-pick-album"
                  type="text" value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-ink-2">
              {t('song.cover.noTemplateHint')}
            </p>
          )}

          <div>
            <label htmlFor="cover-pick-url" className={LABEL_CLS}>{t('song.cover.imageUrl')}</label>
            <Input
              id="cover-pick-url"
              type="url" value={directUrl} placeholder={templateUrl || 'https://…'}
              onChange={(e) => setDirectUrl(e.target.value)}
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={handlePreview}
            disabled={!resolvedUrl || status === 'loading'}
          >
            {status === 'loading'
              ? <><ArrowsClockwise className="w-4 h-4 animate-spin motion-reduce:animate-none" />{t('action.loading')}</>
              : <><MagnifyingGlass className="w-4 h-4" />{t('song.cover.preview')}</>
            }
          </Button>

          {status === 'error' && (
            <p className="text-[13px] text-danger">{t('song.cover.loadFailed')}</p>
          )}

          {previewUrl && (
            <div>
              <p className="text-[13px] text-ink-3 mb-2">{t('song.cover.previewLabel')}</p>
              <div className="cover-frame h-40 w-40 shadow-md">
                {/* 用原生 img 直接验证可加载性，不走 ImageWithFallback 的多来源合并 */}
                <img
                  key={`${previewUrl}#${attempt}`}
                  src={previewUrl}
                  alt={t('song.cover.previewAlt')}
                  className={cn('w-full h-full object-cover', status !== 'ok' && 'opacity-0')}
                  onLoad={() => setStatus('ok')}
                  onError={() => setStatus('error')}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center gap-3 mt-2 flex-shrink-0">
          {pinnedUrl ? (
            <Button
              variant="ghost"
              onClick={() => { onClear(); onClose() }}
              className="text-danger hover:text-danger"
            >
              <X className="w-4 h-4" />{t('song.cover.removeLocal')}
            </Button>
          ) : <span />}
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />{t('action.cancel')}
            </Button>
            <Button onClick={handleConfirm} disabled={status !== 'ok'}>
              <FloppyDisk className="w-4 h-4" />{t('action.confirmSave')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────

export default function SongDetailPage() {
  const { t } = useT()
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const stateSong = location.state?.song as Song | undefined
  const activeServerId = useServerStore(s => s.activeServerId)

  /*
   * 这一页展示的是「**某个音源上**的那首歌」，不是「主库上的那首歌」。
   *
   * 混源列表里的 id 只在它自己的来源里有意义：不看 ?src= 就照主库去查，
   * 网易云的一首歌会拿着网易云的 id 去问 NAS——查不到，页面直接落到
   * 「找不到这首歌」，而 state 里明明有它。三级回落：
   * 地址栏 ?src=（刷新后唯一还在的线索）> state 里那首歌自己的来源 > 主库。
   */
  const srcParam = sourceParam(searchParams) ?? ''
  const serverId = srcParam || stateSong?.serverId || activeServerId || ''

  /*
   * 详情查询按 serverId 路由。这里没走 useSongDetail：那个 hook 写死
   * getAdapter()（主库），而它同时还是别处单源调用方的入口，不在这条改动的
   * 范围里。缓存键的形状与 useServerQueries 的约定一致（[来源, 'songs', …]），
   * 键首位带来源，两个音源出现同 id 的歌时不会互相串。
   */
  const { data: fetchedSong, isLoading, isError, error: queryError, refetch } = useQuery({
    queryKey: [serverId || 'no-server', 'songs', 'detail', id ?? ''] as const,
    queryFn: () => getAdapterFor(serverId).getSong(id ?? ''),
    enabled: !!id && hasAdapterFor(serverId),
    initialData: stateSong,
    staleTime: 10 * 60 * 1000,
  })
  const song = fetchedSong ?? stateSong
  const setFullscreen = usePlayerStore(s => s.setFullscreen)
  /* 「正在播放的就是这首」才提供「进全屏」（阶段 1.8）：此前这个入口
   * navigate(-1) 再 setFullscreen——打开的是正在播放那首的全屏，
   * 不是用户正在看详情的这一首。其余情况直接在本页渲染歌词。 */
  const playingSong = usePlayerStore(s => s.currentSong)
  const isPlayingThis = !!song && !!playingSong
    && playingSong.id === song.id && (playingSong.serverId ?? '') === serverId
  const { saveLyrics } = useLyricCacheStore()
  const saveCover = useCoverCacheStore(s => s.saveCover)
  const removeCover = useCoverCacheStore(s => s.removeCover)
  const pinnedCover = usePinnedCover(song?.id)

  const [lyricsSearchOpen, setLyricsSearchOpen] = useState(false)
  /* 本曲歌词预览（阶段 1.8）：非正在播放的歌不再「后退再开别人的全屏」 */
  const [lyricsPreviewOpen, setLyricsPreviewOpen] = useState(false)
  const previewLyricsQuery = useLyricsQuery(
    song?.id ?? '',
    song?.title,
    song?.artist,
    song?.album,
    song?.path,
    song?.duration,
    lyricsPreviewOpen && !!song,
    serverId
  )
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  /*
   * 能力有两级，和 SongList 的行级门控同一套规矩：
   *
   * - `sourceCaps[serverId]`：**这首歌的来源**声明了什么（PROTOCOL §6）。
   *   取不到（来源已断开、或老地址没带 ?src=）时不擅自藏入口，
   *   回落成改动前的行为，免得单源用户的入口凭空消失。
   * - `capabilities`：**主库**的客户端能力。分享要真的问一次服务器，
   *   而 ShareDialog 写回走 getAdapter()——非主库的歌给了入口也只会写错地方。
   */
  const sourceCaps = useSourceCapabilities()
  const rowCaps = sourceCaps[serverId]
  const isPrimarySource = !!serverId && serverId === activeServerId
  const capabilities = useServerCapabilities()

  if (isLoading && !song) {
    return (
      <div className="pb-8" aria-busy="true">
        <div className="pb-2 pt-2 regular:pt-4" aria-hidden="true">
          <div className="grid grid-cols-1 items-end justify-items-center gap-6 regular:grid-cols-[220px_minmax(0,1fr)] regular:justify-items-start regular:gap-8 wide:grid-cols-[264px_minmax(0,1fr)] wide:gap-10">
            <div className="skeleton cover-frame aspect-square w-[min(72vw,280px)] regular:w-full" />
            <div className="flex w-full min-w-0 flex-col items-center gap-3 regular:items-start">
              <div className="skeleton h-10 w-2/3 rounded-md regular:h-12" />
              <div className="skeleton h-5 w-40 rounded-md" />
              <div className="skeleton h-4 w-56 rounded-md" />
              <div className="mt-2 flex gap-3">
                <div className="skeleton h-11 w-36 rounded-pill" />
                <div className="skeleton h-11 w-32 rounded-pill" />
              </div>
            </div>
          </div>
        </div>
        <div className="sheet mt-8 space-y-5 p-6" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-4 rounded-sm" />
          ))}
        </div>
      </div>
    )
  }

  /*
   * 查询出错与「真的没有」是两件事（复核 F2）：适配器只把 404 / not-found
   * 转成 null，401 / 断网原样抛——这里必须分开设，否则凭据过期又会被
   * 显示成「找不到这首歌」。
   */
  if (isError) {
    const code = pluginErrorCode(queryError)
    if (code === 'unauthorized') {
      return (
        <div className="mx-auto mt-6 max-w-[560px]">
          <EmptyState mascot="maodou-surprised"
            title={t('sources.authExpired')}
            action={{ label: t('action.back'), onClick: () => navigate(-1) }}
          />
        </div>
      )
    }
    return (
      <div className="mx-auto mt-6 max-w-[560px]">
        <ErrorState
          ruled={false}
          retry={() => void refetch()}
          onBack={() => navigate(-1)}
        />
      </div>
    )
  }

  if (!song) {
    return (
      <div className="mx-auto mt-6 max-w-[560px]">
        <EmptyState mascot="maodou-surprised"
          title={t('empty.song.title')}
          action={{ label: t('action.back'), onClick: () => navigate(-1) }}
        />
      </div>
    )
  }

  const handleLyricsSave = async (lrcText: string) => {
    saveLyrics(song.id, lrcText, song.serverId)
    toast({ title: t('lyrics.savedLocally') })
  }

  const handleCoverSave = (url: string) => {
    saveCover(song.id, url)
    toast({ title: t('song.cover.pinned') })
  }

  const handleCoverClear = () => {
    removeCover(song.id)
    toast({ title: t('song.cover.removed') })
  }

  const specLine = buildSpecLine(song)
  const contentTypeLabel = song.contentType
    ? song.contentType.split('/')[1]?.toLowerCase() ?? song.contentType
    : undefined

  /* 头部的元信息：年份 / 时长 / 格式，各占一个独立 span，缺哪项就少哪项 */
  const heroMeta = [
    song.year != null ? String(song.year) : '',
    song.duration > 0 ? formatDuration(song.duration) : '',
    contentTypeLabel ?? '',
  ].filter(Boolean)

  /* 封面：大图 600 保证封面在高分屏上清楚；取色只要小图（钉住的本地封面优先，它才是眼前这张） */
  const coverAdapter = findAdapterFor(song.serverId)
  const coverSrc = song.coverArt ? (coverAdapter?.getCoverUrl(song.coverArt, 600) ?? undefined) : undefined
  const paletteUrl = pinnedCover
    ?? (song.coverArt ? (coverAdapter?.getCoverUrl(song.coverArt, 300) ?? undefined) : undefined)

  return (
    <div className="pb-8">
      {/* 头部：DetailHero——封面带着自己的光，歌手 / 专辑链接是副标题，
          元信息的第一项回答「这一版来自哪儿」：同一首歌在两个音源上的
          时长、码率、专辑归属都可能不一样，不说明来源这一整页都读不准 */}
      <DetailHero
        cover={
          <ImageWithFallback
            src={coverSrc}
            alt={song.title}
            fallbackType="album"
            className="h-full w-full"
            songId={song.id}
            customCoverParams={{ type: 'song', title: song.title, artist: song.artist, album: song.album, path: song.path }}
          />
        }
        coverUrl={paletteUrl}
        title={spaceCJK(song.title)}
        subtitle={
          <div className="flex flex-wrap items-center justify-center gap-x-3 regular:justify-start">
            {song.artistId ? (
              <button
                type="button"
                onClick={() => navigate(detailPath('artists', song.artistId, song.serverId))}
                className="inline-flex min-h-11 items-center rounded-sm transition-colors duration-2 hover:underline hover:underline-offset-4"
              >
                {spaceCJK(song.artist)}
              </button>
            ) : (
              <span className="text-ink">{spaceCJK(song.artist)}</span>
            )}
            {song.album && (song.albumId ? (
              <button
                type="button"
                onClick={() => navigate(detailPath('albums', song.albumId, song.serverId))}
                className="inline-flex min-h-11 items-center rounded-sm font-medium text-ink-2 transition-colors duration-2 hover:text-leaf hover:underline hover:underline-offset-4"
              >
                {song.album}
              </button>
            ) : (
              <span className="font-medium text-ink-2">{song.album}</span>
            ))}
          </div>
        }
        meta={
          <>
            <SourceBadge serverId={serverId} withName />
            {heroMeta.map(item => <span key={item}>{item}</span>)}
          </>
        }
        actions={
          <>
            {/* 动作行：歌词是主操作（来源不提供歌词就没有可看的，入口整个不出现，
                而不是让人点进播放器再看到一句「暂无歌词」）；其余是中性胶囊 / 圆键。
                本机的「歌词搜索」不受影响——那一条走的是自定义接口，与来源无关 */}
            {(rowCaps ? rowCaps.lyrics : true) && (
              <Button
                type="button"
                onClick={() => {
                  if (isPlayingThis) {
                    navigate(-1)
                    setTimeout(() => setFullscreen(true), 50)
                  } else {
                    setLyricsPreviewOpen(true)
                  }
                }}
              >
                <TextAlignLeft size={18} />
                <span>{isPlayingThis ? t('lyrics.viewOrSearch') : t('lyrics.viewHere')}</span>
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              title={t('lyrics.customParams')}
              onClick={() => setLyricsSearchOpen(true)}
            >
              <MagnifyingGlass size={18} />
              <span>{t('lyrics.search')}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className={cn('h-11 w-11', pinnedCover && 'text-leaf')}
              aria-label={pinnedCover ? t('song.cover.change') : t('song.cover.setLocal')}
              title={pinnedCover ? t('song.cover.change') : t('song.cover.setLocal')}
              onClick={() => setCoverPickerOpen(true)}
            >
              <ImageSquare size={20} weight={pinnedCover ? 'fill' : 'regular'} />
            </Button>
            {/* 只有主库服务器真的开着分享才出现（见 useServerCapabilities）。
                ShareDialog 的写回打的是主库适配器：给一首网易云的歌摆出这个入口，
                点下去只会拿它的 id 去让 NAS 建分享 */}
            {isPrimarySource && capabilities.shares && (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-11 w-11"
                aria-label={t('share.link')}
                title={t('share.createHint')}
                onClick={() => setShareOpen(true)}
              >
                <ShareNetwork size={20} />
              </Button>
            )}
          </>
        }
      />

      {/* 边注：先于所有服务器给的字段——这一条是你写的，其余都是别人写的 */}
      <MarginNote target="song" targetId={song.id} className="mt-10" />

      {/* 信息分组：每组一块 sheet，宽窗口并排两列 */}
      <div className="mt-6 grid items-start gap-5 wide:grid-cols-2">
        {/* 基础信息 */}
        {(song.year != null || song.track != null) && (
          <Section title={t('section.basic')}>
            {song.year != null && (
              <Row label={t('song.field.year')} value={String(song.year)} tabular />
            )}
            {song.track != null && (
              <Row label={t('song.field.track')} value={String(song.track)} tabular />
            )}
          </Section>
        )}

        {/* 扩展信息 */}
        <Section title={t('section.file')}>
          {song.path && (
            <Row label={t('song.field.path')} value={song.path} />
          )}
          {song.size != null && song.size > 0 && (
            <Row label={t('song.field.size')} value={formatFileSize(song.size)} tabular />
          )}
          {contentTypeLabel && (
            <Row label={t('song.field.format')} value={contentTypeLabel} />
          )}
          {song.duration > 0 && (
            <Row label={t('song.field.duration')} value={formatDuration(song.duration)} tabular />
          )}
          {song.bitRate != null && song.bitRate > 0 && (
            <Row label={t('song.field.bitRate')} value={`${song.bitRate} kbps`} tabular />
          )}
          {song.playCount != null && song.playCount > 0 && (
            <Row label={t('song.field.playCount')} value={song.playCount} tabular />
          )}
          {song.genre && (
            <Row label={t('song.field.genre')} value={song.genre} />
          )}
          {song.userRating != null && song.userRating > 0 && (
            <Row label={t('song.field.rating')} value={`${song.userRating} / 5`} tabular />
          )}
        </Section>

        {/* 规格铭牌：服务器早就返回这些字段，此前被 mapSong 一律丢弃 */}
        {specLine.length > 0 && (
          <Section title={t('section.spec')}>
            <Row label={t('song.field.audioSpec')} value={<Spans items={specLine} />} tabular />
            {song.ext?.bpm ? <Row label="BPM" value={String(song.ext.bpm)} tabular /> : null}
            {song.ext?.moods?.length ? (
              <Row label={t('song.field.moods')} value={<Spans items={song.ext.moods} />} />
            ) : null}
            {song.ext?.isrc?.length ? (
              <Row label="ISRC" value={<Spans items={song.ext.isrc} />} tabular />
            ) : null}
            {song.ext?.musicBrainzId ? (
              <Row label="MusicBrainz" value={song.ext.musicBrainzId} tabular />
            ) : null}
          </Section>
        )}

        {/* 制作人员 */}
        {(song.ext?.contributors?.length || song.ext?.displayComposer) && (
          <Section title={t('section.credits')}>
            <SongCredits
              contributors={song.ext?.contributors}
              composer={song.ext?.displayComposer}
              serverId={song.serverId}
            />
          </Section>
        )}
      </div>

      {/* 歌词搜索 */}
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        target={{ ids: [song.id], label: song.title, kind: 'song' }}
      />

      <LyricsSearchDialog
        open={lyricsSearchOpen}
        onClose={() => setLyricsSearchOpen(false)}
        song={song}
        onSave={handleLyricsSave}
      />

      {/* 本曲歌词预览（阶段 1.8）：不是正在播放的那首，就在这页看。
          歌词读在一块安静的第二中性面板上 */}
      <Dialog open={lyricsPreviewOpen} onOpenChange={setLyricsPreviewOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto regular:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('player.lyrics')}</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-x-3">
              <span>{spaceCJK(song.title)}</span>
              <span>{spaceCJK(song.artist ?? '')}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-surface-2 px-3 py-2">
            {previewLyricsQuery.data ? (
              <LyricDisplay lines={previewLyricsQuery.data.lines} variant="panel" />
            ) : previewLyricsQuery.isLoading ? (
              <div role="status" className="space-y-3 py-8">
                <span className="sr-only">{t('lyrics.loading')}</span>
                <div aria-hidden="true" className="skeleton mx-auto h-4 w-2/3 rounded-sm" />
                <div aria-hidden="true" className="skeleton mx-auto h-4 w-1/2 rounded-sm" />
                <div aria-hidden="true" className="skeleton mx-auto h-4 w-3/5 rounded-sm" />
              </div>
            ) : previewLyricsQuery.isError ? (
              <p className="py-8 text-center text-[14px] text-danger">{t('lyrics.loadFailed')}</p>
            ) : (
              <p className="py-8 text-center text-[14px] text-ink-3">{t('lyrics.none')}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
