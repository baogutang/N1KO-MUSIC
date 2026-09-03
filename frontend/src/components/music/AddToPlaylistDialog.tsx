import { useEffect, useState } from 'react'
import { HardDrive, Plus } from '@phosphor-icons/react'
import { usePlaylists, useCreatePlaylist, useAddToPlaylist } from '@/hooks/useServerQueries'
import { useLocalPlaylistStore } from '@/store/localPlaylistStore'
import { useServerStore } from '@/store/serverStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/use-toast'
import { useT } from '@/i18n'
import type { Song } from '@/api/types'

interface AddToPlaylistDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  songs: Song[]
}

export function AddToPlaylistDialog({ open, onOpenChange, songs }: AddToPlaylistDialogProps) {
  const { t } = useT()
  const { data: playlists, isLoading } = usePlaylists()
  const addToPlaylist = useAddToPlaylist()
  const createPlaylist = useCreatePlaylist()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // 本地混合歌单：跨源曲目的唯一安全去处（服务器歌单只认主库 id）
  const localPlaylists = useLocalPlaylistStore(s => s.playlists)
  const localLoaded = useLocalPlaylistStore(s => s.loaded)
  const localLoad = useLocalPlaylistStore(s => s.load)
  const createLocal = useLocalPlaylistStore(s => s.create)
  const addSongsToLocal = useLocalPlaylistStore(s => s.addSongs)
  const primaryServerId = useServerStore(s => s.activeServerId)

  useEffect(() => {
    if (open && !localLoaded) void localLoad().catch(() => { /* 分区拿不到就不列，不让加歌流程挂掉 */ })
  }, [open, localLoaded, localLoad])

  // 混入其它音源的歌时，服务器歌单的 id 空间对不上——只允许加本地歌单
  const allFromPrimary = songs.length > 0
    && songs.every(s => s.serverId === primaryServerId || s.serverId === '')

  const songIds = songs.map(s => s.id)

  async function handleAdd(playlistId: string, playlistName: string) {
    try {
      await addToPlaylist.mutateAsync({ playlistId, songIds })
      toast({ title: t('playlist.added', { name: playlistName }) })
      onOpenChange(false)
    } catch {
      toast({ title: t('playlist.addFailed'), variant: 'destructive' })
    }
  }

  async function handleAddLocal(id: string, name: string) {
    try {
      await addSongsToLocal(id, songs)
      toast({ title: t('playlist.added', { name }) })
      onOpenChange(false)
    } catch {
      toast({ title: t('playlist.addFailed'), variant: 'destructive' })
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const pl = await createPlaylist.mutateAsync({ name, songIds })
      toast({ title: t('playlist.createdWithSongs', { name }) })
      setNewName('')
      onOpenChange(false)
      void pl
    } catch {
      toast({ title: t('playlist.createFailed'), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function handleCreateLocal() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      await createLocal(name, songs)
      toast({ title: t('playlist.createdWithSongs', { name }) })
      setNewName('')
      onOpenChange(false)
    } catch {
      toast({ title: t('playlist.createFailed'), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('action.addToPlaylist')}</DialogTitle>
        </DialogHeader>

        {!allFromPrimary && songs.some(s => s.serverId && s.serverId !== primaryServerId) && (
          <p className="text-[12.5px] leading-relaxed text-ink-faint border-l-2 border-primary/50 pl-3">
            {t('playlist.localOnlyHint')}
          </p>
        )}

        <div className="max-h-64 overflow-y-auto border-t border-hair divide-y divide-hair-soft">
          {/* 本地混合歌单：跨源安全，永远可加 */}
          {localPlaylists.length > 0 && (
            <>
              <p className="px-2 pt-2 pb-1 text-[11px] tracking-[0.2em] text-ink-faint">
                {t('sources.import.localSection')}
              </p>
              {localPlaylists.map(pl => (
                <button
                  key={pl.id}
                  onClick={() => handleAddLocal(pl.id, pl.name)}
                  className="w-full flex items-center gap-3 px-2 py-2.5 text-left transition-colors duration-200 hover:bg-paper-deep"
                >
                  <HardDrive className="w-3.5 h-3.5 text-ink-faint flex-shrink-0" />
                  <span className="font-serif font-semibold text-[14.5px] truncate flex-1">{pl.name}</span>
                  <span className="num text-xs text-ink-faint flex-shrink-0">
                    {t('playlist.songCount', { count: pl.items.length })}
                  </span>
                </button>
              ))}
            </>
          )}

          {/* 服务器歌单：主库的歌才允许进（id 空间一致） */}
          <p className="px-2 pt-2 pb-1 text-[11px] tracking-[0.2em] text-ink-faint">
            {t('playlist.serverPlaylists')}
          </p>
          {isLoading ? (
            // loading：hair-soft 骨架行闪烁（不用 spinner，DESIGN §4.5）
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-3">
                <span className="w-6 h-3 rounded-sm bg-skeleton animate-pulse" />
                <span className="h-3.5 flex-1 rounded-sm bg-skeleton animate-pulse" style={{ animationDelay: `${i * 0.1}s` }} />
              </div>
            ))
          ) : playlists?.length ? (
            playlists.map((pl, i) => (
              <button
                key={pl.id}
                onClick={() => handleAdd(pl.id, pl.name)}
                disabled={addToPlaylist.isPending || !allFromPrimary}
                title={!allFromPrimary ? t('playlist.localOnlyHint') : undefined}
                className="w-full flex items-baseline gap-3 px-2 py-3 text-left transition-colors duration-200 hover:bg-paper-deep disabled:opacity-45 disabled:hover:bg-transparent"
              >
                <span className="font-num text-xs text-ink-faint flex-shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-serif font-semibold text-[15px] truncate flex-1">{pl.name}</span>
                {pl.songCount !== undefined && (
                  <span className="font-num text-xs text-ink-faint flex-shrink-0">
                    {t('playlist.songCount', { count: pl.songCount })}
                  </span>
                )}
              </button>
            ))
          ) : (
            <p className="text-sm text-ink-faint text-center py-6">{t('playlist.noneYet')}</p>
          )}
        </div>

        {/* 新建：本地（跨源安全）与服务器（仅主库曲目）两个出口 */}
        <div className="flex gap-2 pt-2 border-t border-hair">
          <Input
            placeholder={t('playlist.namePlaceholder')}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              // isComposing / keyCode 229：中日韩输入法组词期间按 Enter 是确认候选词，不应触发创建
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) handleCreateLocal()
            }}
          />
          <Button
            onClick={handleCreateLocal}
            disabled={creating || !newName.trim()}
            variant="outline"
            size="icon"
            title={t('playlist.createLocal')}
            className="flex-shrink-0"
          >
            <HardDrive className="w-4 h-4" />
          </Button>
          {allFromPrimary && (
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              variant="outline"
              size="icon"
              title={t('playlist.createAndAdd')}
              className="flex-shrink-0"
            >
              <Plus className="w-4 h-4" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
