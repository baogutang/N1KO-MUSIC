/**
 * 跨源歌单导入（PLAN 阶段 5）：选来源歌单 → match.ts 三级匹配进主库 →
 * 新建或追加主库歌单；未匹配清单可一键「放进本地混合歌单」。
 *
 * 匹配目标永远是主库（NAS 写歌单的能力只在它那里）；来源歌单来自任何
 * 声明 userPlaylists 的已连接音源。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeError } from '@/services/errors'
import { useQueryClient } from '@tanstack/react-query'
import { ErrorState } from '@/components/common/ErrorState'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { getAdapter, getAdapterFor } from '@/api'
import type { Playlist, Song } from '@/api/types'
import { useConnectedSources, useSourceCapabilities, useSourcePlaylists } from '@/hooks/useSourceQueries'
import { usePlaylists, useCreatePlaylist, useAddToPlaylist, queryKeys } from '@/hooks/useServerQueries'
import { useLocalPlaylistStore } from '@/store/localPlaylistStore'
import { bestMatchFor, type MatchTier } from '@/plugins/match'
import { cn } from '@/lib/utils'
import { SegmentedPill, selectClass } from '@/components/settings/primitives'
import { useT } from '@/i18n'

type Stage = 'pick' | 'importing' | 'review'

/**
 * 本地混合歌单名 = 歌单名 + 中点 + 后缀。这是已经写进用户数据里的命名格式，保持字符不变
 * （用转义写，源码里不留中点；它是持久化的名字，不是界面上拼出来的元信息。
 * 与 ImportPlaylistDialog 的同名常量同一格式）。
 */
const LOCAL_NAME_SEP = ' \u00B7 '

interface MatchRow {
  song: Song
  tier: MatchTier
}

export function ImportFromSourceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const sources = useConnectedSources()
  const caps = useSourceCapabilities()
  const groups = useSourcePlaylists()
  const createPlaylist = useCreatePlaylist()
  const addToPlaylist = useAddToPlaylist()
  const createLocal = useLocalPlaylistStore(s => s.create)
  const loadLocal = useLocalPlaylistStore(s => s.load)

  const eligible = useMemo(
    () => sources.filter(s => caps[s.serverId]?.userPlaylists),
    [sources, caps]
  )
  const [sourceId, setSourceId] = useState('')
  const [sheet, setSheet] = useState<Playlist | null>(null)
  const [stage, setStage] = useState<Stage>('pick')
  const [matched, setMatched] = useState<MatchRow[]>([])
  const [unmatched, setUnmatched] = useState<Song[]>([])
  const [targetMode, setTargetMode] = useState<'new' | 'append'>('new')
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  /** 取消导入：关对话框或点取消时 abort，worker 全体停下 */
  const cancelRef = useRef<AbortController | null>(null)

  useEffect(() => { void loadLocal() }, [loadLocal])

  const activeSource = eligible.find(s => s.serverId === sourceId) ?? null
  const sourceGroup = groups.find(g => g.serverId === sourceId)

  const reset = useCallback(() => {
    cancelRef.current?.abort()
    cancelRef.current = null
    setStage('pick')
    setSheet(null)
    setMatched([])
    setUnmatched([])
    setTargetMode('new')
    setTargetId('')
    setBusy(false)
    setProgress({ done: 0, total: 0 })
  }, [])

  const runImport = useCallback(async () => {
    if (!sheet || !activeSource) return
    setStage('importing')
    const ctrl = new AbortController()
    cancelRef.current = ctrl
    try {
      const detail = await getAdapterFor(activeSource.serverId).getPlaylistDetail(sheet.id)
      // 0 首：QQ 私有歌单匿名取回就是空——静默进 review 只会让用户对着 0/0 猜
      if (!detail.songs.length) {
        toast({ title: t('sources.import.emptySheet') })
        reset()
        return
      }
      const total = detail.songs.length
      setProgress({ done: 0, total })
      // 并发池：串行 500 首 = 500 个请求排长队，分钟级；6 路并发分钟变秒级。
      // 结果按原歌单下标落位，完成顺序不定也不打乱 review 列表
      const results: Array<MatchRow | null> = new Array(total).fill(null)
      const missingFlag = new Array<boolean>(total).fill(false)
      let cursor = 0
      let done = 0
      const CONCURRENCY = 6
      const worker = async () => {
        for (;;) {
          if (ctrl.signal.aborted) return
          const i = cursor++
          if (i >= total) return
          const song = detail.songs[i]
          // 主库检索（标题 + 歌手），候选交给三级匹配
          const query = `${song.title} ${song.artist}`.trim()
          let found: Song[] = []
          try {
            const result = await getAdapter().searchAll(query)
            found = result.songs ?? []
          } catch { /* 主库搜索失败按未匹配处理 */ }
          const hit = bestMatchFor(song, found)
          if (hit) results[i] = { song: hit.song, tier: hit.tier }
          else missingFlag[i] = true
          done += 1
          setProgress(p => (p.total === total ? { ...p, done } : p))
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker))
      if (ctrl.signal.aborted) return
      setMatched(results.filter((r): r is MatchRow => r !== null))
      setUnmatched(detail.songs.filter((_, i) => missingFlag[i]))
      setStage('review')
    } catch (err) {
      toast({
        title: t('sources.import.failed'),
        description: describeError(err),
        variant: 'destructive',
      })
      reset()
    }
  }, [sheet, activeSource, t, reset])

  const { data: primaryPlaylists } = usePlaylists()

  const handleCreate = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const ids = matched.map(r => r.song.id)
      /* 一条都没匹配上时跳过服务端写入（复核 F3④）：只建本地混合歌单，
       * 不给主库塞一张空歌单。与 ImportPlaylistDialog 的 if (matched.length) 同规则。 */
      if (ids.length) {
        if (targetMode === 'new') {
          await createPlaylist.mutateAsync({ name: sheet?.name ?? t('sources.import.defaultName'), songIds: ids })
        } else {
          if (!targetId) return
          await addToPlaylist.mutateAsync({ playlistId: targetId, songIds: ids })
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.playlists() })
      }
      const localCount = unmatched.length
      if (localCount > 0) {
        await createLocal(`${sheet?.name ?? t('sources.import.defaultName')}${LOCAL_NAME_SEP}${t('sources.import.localSuffix')}`, unmatched)
      }
      toast({
        title: ids.length
          ? t('sources.import.done', { count: ids.length, name: sheet?.name ?? '' })
          : t('sources.import.localCreated', { count: localCount }),
        description: ids.length && localCount > 0 ? t('sources.import.localCreated', { count: localCount }) : undefined,
      })
      onOpenChange(false)
      reset()
    } catch (err) {
      toast({
        title: t('sources.import.createFailed'),
        description: describeError(err),
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }, [busy, matched, targetMode, targetId, sheet, unmatched, createPlaylist, addToPlaylist, createLocal, queryClient, onOpenChange, reset, t])

  const tierLabel = (tier: MatchTier) =>
    tier === 'isrc' ? t('sources.import.tierIsrc')
      : tier === 'exact' ? t('sources.import.tierExact')
        : t('sources.import.tierFuzzy')

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        // 导入进行中关对话框 = 取消：不 abort 的话闭包会把整个歌单跑完
        if (!next) cancelRef.current?.abort()
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sources.import.title')}</DialogTitle>
          <DialogDescription>{t('sources.import.description')}</DialogDescription>
        </DialogHeader>

        {stage === 'pick' && (
          <div className="space-y-5 py-1">
            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-ink-3">{t('sources.import.pickSource')}</h3>
              <div className="flex flex-wrap gap-2">
                {eligible.map(s => (
                  <button
                    key={s.serverId}
                    type="button"
                    aria-pressed={sourceId === s.serverId}
                    onClick={() => setSourceId(s.serverId)}
                    className={cn(
                      'press-pop inline-flex min-h-11 items-center gap-2 rounded-pill px-4 text-[14px] font-semibold',
                      sourceId === s.serverId
                        ? 'bg-ink text-ground'
                        : 'bg-fill text-ink-2 hover:bg-fill-2 hover:text-ink'
                    )}
                  >
                    <SourceBadge serverId={s.serverId} />
                    <span>{s.name}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* 三态（阶段 2.2）：加载 / 失败不再是一片空白 */}
            {activeSource && sourceGroup?.status === 'loading' && (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton h-9 rounded-sm" />
                ))}
              </div>
            )}
            {activeSource && sourceGroup?.status === 'error' && (
              <ErrorState retry={() => { void queryClient.invalidateQueries({ queryKey: [activeSource, 'playlists'] }) }} />
            )}
            {activeSource && sourceGroup?.data?.length === 0 && (
              <p className="py-4 text-center text-[14px] text-ink-3">{t('sources.import.noSheets')}</p>
            )}
            {activeSource && sourceGroup?.status === 'success' && sourceGroup.data && sourceGroup.data.length > 0 && (
              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-ink-3">{t('sources.import.pickSheet')}</h3>
                <div className="max-h-56 overflow-y-auto rounded-lg bg-surface-2 p-1">
                  {sourceGroup.data!.map(pl => (
                    <button
                      key={pl.id}
                      type="button"
                      aria-pressed={sheet?.id === pl.id}
                      onClick={() => setSheet(pl)}
                      className={cn(
                        'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left transition-colors duration-1 motion-reduce:transition-none',
                        sheet?.id === pl.id ? 'bg-ink/[0.08] text-leaf' : 'text-ink hover:bg-ink/[0.05]'
                      )}
                    >
                      <span className={cn('min-w-0 flex-1 truncate text-[14px]', sheet?.id === pl.id && 'font-semibold')}>{pl.name}</span>
                      <span className="num text-[12px] text-ink-3">
                        {pl.songCount !== undefined ? t('song.count', { count: pl.songCount }) : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <Button
              disabled={!sheet || !activeSource}
              onClick={() => void runImport()}
              className="w-full"
            >
              {t('sources.import.start')}
            </Button>
          </div>
        )}

        {stage === 'importing' && (
          <div className="space-y-4 py-8 text-center">
            <p className="text-[14px] text-ink-2">
              {t('sources.import.running')}
              <span className="num ml-2 text-[12px] text-ink-3">
                {t('sources.import.progress', { done: progress.done, total: progress.total })}
              </span>
            </p>
            {/* 进度条：凹槽里一段青柠，用 scaleX 推进（不动画宽度） */}
            <div className="mx-auto h-2 w-48 overflow-hidden rounded-pill bg-fill-2" role="progressbar"
              aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total}>
              <div
                className="h-full origin-left rounded-pill bg-lime transition-transform duration-4 motion-reduce:transition-none"
                style={{ transform: `scaleX(${progress.total ? progress.done / progress.total : 0})` }}
              />
            </div>
            <Button variant="secondary" onClick={() => reset()}>
              {t('action.cancel')}
            </Button>
          </div>
        )}

        {stage === 'review' && (
          <div className="space-y-4 py-1">
            <p className="text-[14px] text-ink-2">
              {t('sources.import.review', {
                matched: matched.length,
                fuzzy: matched.filter(r => r.tier === 'fuzzy').length,
                unmatched: unmatched.length,
              })}
            </p>

            {matched.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg bg-surface-2 py-1">
                {matched.slice(0, 30).map(row => (
                  <p key={`${row.song.serverId}:${row.song.id}`} className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-ink">
                    <SourceBadge serverId={row.song.serverId} />
                    <span className="flex min-w-0 flex-1 gap-x-3">
                      <span className="truncate">{row.song.title}</span>
                      <span className="truncate text-ink-3">{row.song.artist}</span>
                    </span>
                    <span className={cn('flex-shrink-0 text-[12px]', row.tier === 'fuzzy' ? 'font-semibold text-leaf' : 'text-ink-3')}>
                      {tierLabel(row.tier)}
                    </span>
                  </p>
                ))}
              </div>
            )}
            {unmatched.length > 0 && (
              <div className="max-h-32 overflow-y-auto rounded-lg bg-surface-2 py-1">
                {unmatched.slice(0, 20).map(song => (
                  <p key={`${song.serverId}:${song.id}`} className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-ink-3">
                    <SourceBadge serverId={song.serverId} />
                    <span className="flex min-w-0 flex-1 gap-x-3">
                      <span className="truncate">{song.title}</span>
                      <span className="truncate">{song.artist}</span>
                    </span>
                    <span className="flex-shrink-0 text-[12px]">{t('sources.import.unmatched')}</span>
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <SegmentedPill
                semantics="pressed"
                value={targetMode}
                onChange={setTargetMode}
                options={[
                  { value: 'new', label: t('sources.import.targetNew') },
                  { value: 'append', label: t('sources.import.targetAppend') },
                ]}
              />
              {targetMode === 'append' && (
                <select
                  value={targetId}
                  onChange={e => setTargetId(e.target.value)}
                  aria-label={t('sources.import.pickTarget')}
                  className={cn(selectClass, 'block w-full')}
                >
                  <option value="">{t('sources.import.pickTarget')}</option>
                  {(primaryPlaylists ?? []).map(pl => (
                    <option key={pl.id} value={pl.id}>{pl.name}</option>
                  ))}
                </select>
              )}
            </div>

            <Button
              disabled={
                busy
                  /* 同 ImportPlaylistDialog 的规则（复核 F3④）：只命中未匹配也可建本地单；
                   * 追加模式只有在真有匹配歌要追加时才要求选目标 */
                  || (matched.length === 0 && unmatched.length === 0)
                  || (matched.length > 0 && targetMode === 'append' && !targetId)
              }
              onClick={() => void handleCreate()}
              className="w-full"
            >
              {busy ? t('action.creating') : t('sources.import.confirm')}
            </Button>
            <p className="text-[13px] leading-relaxed text-ink-3">
              {t('sources.import.localHint', { count: unmatched.length })}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
