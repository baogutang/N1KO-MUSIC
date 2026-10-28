/**
 * 导入歌单（M3U / M3U8 / XSPF）。
 *
 * 文件在本地解析，条目逐条拿去问**所有已连接音源**的搜索再严格匹配
 * （阶段 5 聚合候选）——主库命中的进服务端歌单；只在其他音源命中的
 * 那部分可一键放进「本地混合歌单」。对不上的会原样列出来给用户看，
 * 而不是悄悄少几首。
 */

import { useCallback, useRef, useState } from 'react'
import { UploadSimple, Warning } from '@phosphor-icons/react'
import { getAdapter, getAdapterFor, hasAdapterFor } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { useLocalPlaylistStore } from '@/store/localPlaylistStore'
import {
  parsePlaylistFile, resolvePlaylistEntries, MAX_IMPORT_ENTRIES,
  type ParsedPlaylistEntry,
} from '@/services/playlistFiles'
import { queryKeys } from '@/hooks/useServerQueries'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'
import type { Song } from '@/api/types'

type Stage = 'pick' | 'resolving' | 'review' | 'creating'

/** 未匹配清单最多展示这么多条，其余折成一句话 */
const MISSING_PREVIEW = 8

/**
 * 本地混合歌单名 = 歌单名 + 中点 + 后缀。这是已经写进用户数据里的命名格式，保持字符不变
 * （用转义写，源码里不留中点；它是持久化的名字，不是界面上拼出来的元信息）。
 */
const LOCAL_NAME_SEP = ' \u00B7 '

export function ImportPlaylistDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useT()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('pick')
  const [name, setName] = useState('')
  const [matched, setMatched] = useState<Song[]>([])
  const [foreign, setForeign] = useState<Song[]>([])
  const [missing, setMissing] = useState<ParsedPlaylistEntry[]>([])
  const [truncated, setTruncated] = useState(0)

  const reset = useCallback(() => {
    setStage('pick')
    setName('')
    setMatched([])
    setForeign([])
    setMissing([])
    setTruncated(0)
    if (fileRef.current) fileRef.current.value = ''
  }, [])

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text()
    const entries = parsePlaylistFile(file.name, text)
    if (!entries.length) {
      toast({ title: t('playlist.import.noEntries'), variant: 'destructive' })
      return
    }
    setName(file.name.replace(/\.[^.]+$/, ''))
    setStage('resolving')
    try {
      const result = await resolvePlaylistEntries(entries, async query => {
        // 聚合所有已连接音源的搜索候选（阶段 5 TODO 落地）；
        // 单源失败按空候选处理，不让一条拖垮整次导入
        const connected = useServerStore.getState().connectedServerIds
        const results = await Promise.allSettled(
          connected.filter(id => hasAdapterFor(id)).map(id => getAdapterFor(id).searchAll(query))
        )
        return results.flatMap(r => (r.status === 'fulfilled' ? r.value.songs ?? [] : []))
      })
      const primaryId = useServerStore.getState().activeServerId ?? ''
      setMatched(result.matched.filter(song => song.serverId === primaryId))
      setForeign(result.matched.filter(song => song.serverId !== primaryId))
      setMissing(result.missing)
      setTruncated(result.truncated)
      setStage('review')
    } catch {
      toast({ title: t('playlist.import.matchFailed'), variant: 'destructive' })
      setStage('pick')
    }
  }, [t])

  const handleCreate = useCallback(async () => {
    /*
     * matched===0 也允许建（阶段 2.2）：全未匹配时把**全部条目**放进
     * 本地混合歌单——「答应过的本地混合歌单」不能因为一条都匹配不上就灰掉。
     * matched>0 时维持原语义：服务端单 + 外源落本地。
     */
    /* matched===0 时把未匹配条目转成最小 Song（仅本地歌单展示用）。
     * serverId 用 'local' 哨兵：toEntries 会过滤 serverId 为空的歌（复核 F3：
     * 空串建出的本地单是空的，toast 却说有 N 首）；'local' 不在 servers 里，
     * 徽标不渲染、也永远命中不了适配器——它只是一条待匹配的占位。 */
    const missingAsSongs: Song[] = missing.map((entry, i) => ({
      id: `unmatched-${i}`,
      serverId: 'local',
      title: entry.title ?? entry.location,
      artist: entry.artist ?? '',
      album: entry.album ?? '',
      duration: entry.durationSeconds ?? 0,
    }))
    /* 外源歌不因 matched===0 被丢掉（复核 F3①）：全未匹配主库但命中外源时，
     * foreign 与 missing 占位一起进本地混合歌单 */
    const localSongs = [...foreign, ...(matched.length ? [] : missingAsSongs)]
    if (!name.trim() || (!matched.length && !localSongs.length)) return
    setStage('creating')
    try {
      if (matched.length) {
        const adapter = getAdapter()
        await adapter.createPlaylist(name.trim(), matched.map(song => song.id))
        queryClient.invalidateQueries({ queryKey: queryKeys.playlists() })
      }
      const localCount = localSongs.length
      if (localCount > 0) {
        await useLocalPlaylistStore.getState().create(`${name.trim()}${LOCAL_NAME_SEP}${t('sources.import.localSuffix')}`, localSongs)
      }
      toast({
        title: t('playlist.import.done', { count: matched.length, name: name.trim() }),
        description: localCount > 0 ? t('sources.import.localCreated', { count: localCount }) : undefined,
      })
      onOpenChange(false)
      reset()
    } catch {
      toast({ title: t('playlist.createFailed'), variant: 'destructive' })
      setStage('review')
    }
  }, [name, matched, foreign, missing, queryClient, onOpenChange, reset, t])

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
          <DialogTitle>{t('playlist.import.title')}</DialogTitle>
          <DialogDescription>
            {t('playlist.import.description')}
          </DialogDescription>
        </DialogHeader>

        {stage === 'pick' && (
          <div className="py-1">
            <input
              ref={fileRef}
              type="file"
              accept=".m3u,.m3u8,.xspf,audio/x-mpegurl,application/xspf+xml"
              className="sr-only"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-2.5 rounded-lg bg-fill py-10 text-ink-2 transition-colors duration-2 hover:bg-fill-2 hover:text-ink"
            >
              <span className="grid h-12 w-12 place-items-center rounded-pill bg-surface text-ink">
                <UploadSimple size={24} />
              </span>
              <span className="text-[15px] font-semibold">{t('playlist.import.pickFile')}</span>
              <span className="num text-[13px] text-ink-3">
                {t('playlist.import.limit', { count: MAX_IMPORT_ENTRIES })}
              </span>
            </button>
          </div>
        )}

        {stage === 'resolving' && (
          <p role="status" className="py-10 text-center text-[14px] text-ink-2">
            {t('playlist.import.resolving')}
          </p>
        )}

        {(stage === 'review' || stage === 'creating') && (
          <div className="space-y-5 py-1">
            <div>
              <label htmlFor="import-playlist-name" className="mb-2 block text-[15px] font-medium text-ink">
                {t('playlist.name')}
              </label>
              <Input
                id="import-playlist-name"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>

            <p className="num flex flex-wrap gap-x-3 text-[14px]">
              <span className="font-semibold text-leaf">
                {t('playlist.import.matched', { count: matched.length })}
              </span>
              {missing.length > 0 && (
                <span className="text-ink-3">
                  {t('playlist.import.missing', { count: missing.length })}
                </span>
              )}
              {truncated > 0 && (
                <span className="text-ink-3">
                  {t('playlist.import.truncated', { count: truncated })}
                </span>
              )}
            </p>

            {foreign.length > 0 && (
              <section>
                <h3 className="text-[14px] font-semibold text-ink">
                  {t('sources.import.foreignOnly', { count: foreign.length })}
                </h3>
                <ul className="mt-2 space-y-1 text-[13.5px] text-ink-2">
                  {foreign.slice(0, MISSING_PREVIEW).map(song => (
                    <li key={`${song.serverId}:${song.id}`} className="truncate">
                      {spaceCJK(`${song.title} - ${song.artist}`)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 text-[13px] text-ink-3">
                  {t('sources.import.localHint', { count: foreign.length })}
                </p>
              </section>
            )}

            {missing.length > 0 && (
              <section>
                <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
                  <Warning size={16} weight="fill" aria-hidden="true" className="flex-none text-candy-warn-fill" />
                  {t('playlist.import.missingTitle')}
                </h3>
                <ul className="mt-2 space-y-1 text-[13.5px] text-ink-2">
                  {missing.slice(0, MISSING_PREVIEW).map((entry, i) => (
                    <li key={`${entry.location}-${i}`} className="truncate">
                      {spaceCJK(
                        [entry.artist, entry.title].filter(Boolean).join(' - ') || entry.location
                      )}
                    </li>
                  ))}
                </ul>
                {missing.length > MISSING_PREVIEW && (
                  <p className="num mt-2.5 text-[13px] text-ink-3">
                    {t('playlist.import.moreMissing', { count: missing.length - MISSING_PREVIEW })}
                  </p>
                )}
              </section>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={reset} disabled={stage === 'creating'}>
                {t('playlist.import.anotherFile')}
              </Button>
              <Button onClick={handleCreate} disabled={(!(matched.length || foreign.length || missing.length) || !name.trim() || stage === 'creating')}>
                {stage === 'creating'
                  ? t('action.creating')
                  : t('playlist.import.create', { count: matched.length || missing.length })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
