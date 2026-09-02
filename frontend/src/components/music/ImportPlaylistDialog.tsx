/**
 * 导入歌单（M3U / M3U8 / XSPF）。
 *
 * 文件在本地解析，条目逐条拿去问服务端搜索再严格匹配——不下载整个曲库。
 * 对不上的会原样列出来给用户看，而不是悄悄少几首。
 */

import { useCallback, useRef, useState } from 'react'
import { UploadSimple, Warning } from '@phosphor-icons/react'
import { getAdapter } from '@/api'
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
  const [missing, setMissing] = useState<ParsedPlaylistEntry[]>([])
  const [truncated, setTruncated] = useState(0)

  const reset = useCallback(() => {
    setStage('pick')
    setName('')
    setMatched([])
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
        // TODO(sources): 文本导入的匹配候选应聚合所有已连接音源，阶段 5 与跨源导入一起做
        const found = await getAdapter().searchAll(query)
        return found.songs ?? []
      })
      setMatched(result.matched)
      setMissing(result.missing)
      setTruncated(result.truncated)
      setStage('review')
    } catch {
      toast({ title: t('playlist.import.matchFailed'), variant: 'destructive' })
      setStage('pick')
    }
  }, [t])

  const handleCreate = useCallback(async () => {
    if (!name.trim() || !matched.length) return
    setStage('creating')
    try {
      const adapter = getAdapter()
      await adapter.createPlaylist(name.trim(), matched.map(song => song.id))
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() })
      toast({ title: t('playlist.import.done', { count: matched.length, name: name.trim() }) })
      onOpenChange(false)
      reset()
    } catch {
      toast({ title: t('playlist.createFailed'), variant: 'destructive' })
      setStage('review')
    }
  }, [name, matched, queryClient, onOpenChange, reset, t])

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
          <div className="py-2">
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
              className="flex w-full flex-col items-center gap-2.5 border border-dashed border-hair py-10 text-ink-soft transition-colors duration-200 hover:border-primary hover:text-primary"
            >
              <UploadSimple size={22} />
              <span className="text-sm">{t('playlist.import.pickFile')}</span>
              <span className="font-num text-[11px] text-ink-faint">
                {t('playlist.import.limit', { count: MAX_IMPORT_ENTRIES })}
              </span>
            </button>
          </div>
        )}

        {stage === 'resolving' && (
          <p className="py-10 text-center text-sm text-ink-soft">
            {t('playlist.import.resolving')}
          </p>
        )}

        {(stage === 'review' || stage === 'creating') && (
          <div className="space-y-5 py-1">
            <div>
              <label htmlFor="import-playlist-name" className="mb-1.5 block text-[11px] tracking-[0.18em] text-ink-faint">
                {t('playlist.name')}
              </label>
              <Input
                id="import-playlist-name"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>

            <p className="font-num text-[13px]">
              <span className="text-primary">
                {t('playlist.import.matched', { count: matched.length })}
              </span>
              {missing.length > 0 && (
                <span className="text-ink-faint">
                  {' · '}
                  {t('playlist.import.missing', { count: missing.length })}
                </span>
              )}
              {truncated > 0 && (
                <span className="text-ink-faint">
                  {' · '}
                  {t('playlist.import.truncated', { count: truncated })}
                </span>
              )}
            </p>

            {missing.length > 0 && (
              <div className="border-t border-hair pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] tracking-[0.16em] text-ink-faint">
                  <Warning size={12} />
                  {t('playlist.import.missingTitle')}
                </p>
                <ul className="space-y-1 text-[12.5px] text-ink-soft">
                  {missing.slice(0, MISSING_PREVIEW).map((entry, i) => (
                    <li key={`${entry.location}-${i}`} className="truncate">
                      {spaceCJK(
                        [entry.artist, entry.title].filter(Boolean).join(' - ') || entry.location
                      )}
                    </li>
                  ))}
                </ul>
                {missing.length > MISSING_PREVIEW && (
                  <p className="font-num mt-1.5 text-[11px] text-ink-faint">
                    {t('playlist.import.moreMissing', { count: missing.length - MISSING_PREVIEW })}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="ghost" onClick={reset} disabled={stage === 'creating'}>
                {t('playlist.import.anotherFile')}
              </Button>
              <Button onClick={handleCreate} disabled={!matched.length || !name.trim() || stage === 'creating'}>
                {stage === 'creating'
                  ? t('action.creating')
                  : t('playlist.import.create', { count: matched.length })}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
