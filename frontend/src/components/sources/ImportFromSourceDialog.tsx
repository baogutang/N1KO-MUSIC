/**
 * 跨源歌单导入（PLAN 阶段 5）：选来源歌单 → match.ts 三级匹配进主库 →
 * 新建或追加主库歌单；未匹配清单可一键「放进本地混合歌单」。
 *
 * 匹配目标永远是主库（NAS 写歌单的能力只在它那里）；来源歌单来自任何
 * 声明 userPlaylists 的已连接音源。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
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
import { useT } from '@/i18n'

type Stage = 'pick' | 'importing' | 'review'

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

  useEffect(() => { void loadLocal() }, [loadLocal])

  const activeSource = eligible.find(s => s.serverId === sourceId) ?? null
  const sourceGroup = groups.find(g => g.serverId === sourceId)

  const reset = useCallback(() => {
    setStage('pick')
    setSheet(null)
    setMatched([])
    setUnmatched([])
    setTargetMode('new')
    setTargetId('')
    setBusy(false)
  }, [])

  const runImport = useCallback(async () => {
    if (!sheet || !activeSource) return
    setStage('importing')
    try {
      const detail = await getAdapterFor(activeSource.serverId).getPlaylistDetail(sheet.id)
      const rows: MatchRow[] = []
      const missing: Song[] = []
      for (const song of detail.songs) {
        // 主库检索（标题 + 歌手），候选交给三级匹配
        const query = `${song.title} ${song.artist}`.trim()
        let found: Song[] = []
        try {
          const result = await getAdapter().searchAll(query)
          found = result.songs ?? []
        } catch { /* 主库搜索失败按未匹配处理 */ }
        const hit = bestMatchFor(song, found)
        if (hit) {
          rows.push({ song: hit.song, tier: hit.tier })
        } else {
          missing.push(song)
        }
      }
      setMatched(rows)
      setUnmatched(missing)
      setStage('review')
    } catch (err) {
      toast({
        title: t('sources.import.failed'),
        description: err instanceof Error ? err.message : String(err),
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
      if (targetMode === 'new') {
        await createPlaylist.mutateAsync({ name: sheet?.name ?? t('sources.import.defaultName'), songIds: ids })
      } else {
        if (!targetId) return
        await addToPlaylist.mutateAsync({ playlistId: targetId, songIds: ids })
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() })
      const localCount = unmatched.length
      if (localCount > 0) {
        await createLocal(`${sheet?.name ?? t('sources.import.defaultName')} · ${t('sources.import.localSuffix')}`, unmatched)
      }
      toast({
        title: t('sources.import.done', { count: ids.length, name: sheet?.name ?? '' }),
        description: localCount > 0 ? t('sources.import.localCreated', { count: localCount }) : undefined,
      })
      onOpenChange(false)
      reset()
    } catch (err) {
      toast({
        title: t('sources.import.createFailed'),
        description: err instanceof Error ? err.message : String(err),
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
          <div className="py-2 space-y-4">
            <div>
              <p className="text-[11px] tracking-[0.12em] text-ink-faint mb-2">{t('sources.import.pickSource')}</p>
              <div className="flex flex-wrap gap-3">
                {eligible.map(s => (
                  <button
                    key={s.serverId}
                    onClick={() => setSourceId(s.serverId)}
                    className={cn(
                      'inline-flex items-center gap-2 px-3 py-1.5 border transition-colors',
                      sourceId === s.serverId
                        ? 'border-primary text-primary'
                        : 'border-hair text-ink-soft hover:text-foreground'
                    )}
                  >
                    <SourceBadge serverId={s.serverId} />
                    <span className="text-[13px]">{s.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {activeSource && sourceGroup?.status === 'success' && (
              <div>
                <p className="text-[11px] tracking-[0.12em] text-ink-faint mb-2">{t('sources.import.pickSheet')}</p>
                <div className="max-h-56 overflow-y-auto border-t border-hair">
                  {sourceGroup.data!.map(pl => (
                    <button
                      key={pl.id}
                      onClick={() => setSheet(pl)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 border-b border-hair-soft px-2 py-2.5 text-left transition-colors',
                        sheet?.id === pl.id ? 'bg-paper-deep' : 'hover:bg-paper-deep/60'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">{pl.name}</span>
                      <span className="num text-[11px] text-ink-faint">
                        {pl.songCount !== undefined ? t('song.count', { count: pl.songCount }) : ''}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
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
          <p className="py-10 text-center text-[13px] text-ink-faint">{t('sources.import.running')}</p>
        )}

        {stage === 'review' && (
          <div className="py-2 space-y-4">
            <p className="text-[13px] text-ink-soft">
              {t('sources.import.review', {
                matched: matched.length,
                fuzzy: matched.filter(r => r.tier === 'fuzzy').length,
                unmatched: unmatched.length,
              })}
            </p>

            {matched.length > 0 && (
              <div className="max-h-40 overflow-y-auto border-t border-hair">
                {matched.slice(0, 30).map(row => (
                  <p key={`${row.song.serverId}:${row.song.id}`} className="flex items-center gap-2 border-b border-hair-soft px-2 py-1.5 text-[12.5px]">
                    <SourceBadge serverId={row.song.serverId} />
                    <span className="min-w-0 flex-1 truncate">{row.song.title} · {row.song.artist}</span>
                    <span className={cn('text-[10.5px]', row.tier === 'fuzzy' ? 'text-primary' : 'text-ink-faint')}>
                      {tierLabel(row.tier)}
                    </span>
                  </p>
                ))}
              </div>
            )}
            {unmatched.length > 0 && (
              <div className="max-h-32 overflow-y-auto border-t border-hair">
                {unmatched.slice(0, 20).map(song => (
                  <p key={`${song.serverId}:${song.id}`} className="flex items-center gap-2 border-b border-hair-soft px-2 py-1.5 text-[12.5px] text-ink-faint">
                    <SourceBadge serverId={song.serverId} />
                    <span className="min-w-0 flex-1 truncate">{song.title} · {song.artist}</span>
                    <span className="text-[10.5px]">{t('sources.import.unmatched')}</span>
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setTargetMode('new')}
                  className={cn('pb-1 text-[13px] border-b transition-colors', targetMode === 'new' ? 'border-primary text-primary' : 'border-transparent text-ink-faint')}
                >
                  {t('sources.import.targetNew')}
                </button>
                <button
                  onClick={() => setTargetMode('append')}
                  className={cn('pb-1 text-[13px] border-b transition-colors', targetMode === 'append' ? 'border-primary text-primary' : 'border-transparent text-ink-faint')}
                >
                  {t('sources.import.targetAppend')}
                </button>
              </div>
              {targetMode === 'append' && (
                <select
                  value={targetId}
                  onChange={e => setTargetId(e.target.value)}
                  aria-label={t('sources.import.pickTarget')}
                  className="h-9 w-full bg-transparent border-0 border-b border-hair rounded-none text-sm text-ink-soft focus:outline-none focus:border-primary"
                >
                  <option value="">{t('sources.import.pickTarget')}</option>
                  {(primaryPlaylists ?? []).map(pl => (
                    <option key={pl.id} value={pl.id}>{pl.name}</option>
                  ))}
                </select>
              )}
            </div>

            <Button
              disabled={busy || matched.length === 0 || (targetMode === 'append' && !targetId)}
              onClick={() => void handleCreate()}
              className="w-full"
            >
              {busy ? t('action.creating') : t('sources.import.confirm')}
            </Button>
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              {t('sources.import.localHint', { count: unmatched.length })}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
