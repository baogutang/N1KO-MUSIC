import { useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { usePlaylists, useCreatePlaylist, useAddToPlaylist } from '@/hooks/useServerQueries'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/use-toast'
import type { Song } from '@/api/types'

interface AddToPlaylistDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  songs: Song[]
}

export function AddToPlaylistDialog({ open, onOpenChange, songs }: AddToPlaylistDialogProps) {
  const { data: playlists, isLoading } = usePlaylists()
  const addToPlaylist = useAddToPlaylist()
  const createPlaylist = useCreatePlaylist()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const songIds = songs.map(s => s.id)

  async function handleAdd(playlistId: string, playlistName: string) {
    try {
      await addToPlaylist.mutateAsync({ playlistId, songIds })
      toast({ title: `已添加到「${playlistName}」` })
      onOpenChange(false)
    } catch {
      toast({ title: '添加失败', variant: 'destructive' })
    }
  }

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const pl = await createPlaylist.mutateAsync({ name, songIds })
      toast({ title: `已创建歌单「${name}」并添加歌曲` })
      setNewName('')
      onOpenChange(false)
      void pl
    } catch {
      toast({ title: '创建失败', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加到歌单</DialogTitle>
        </DialogHeader>

        {/* 歌单列表：发丝线分隔的行式列表（mono 序号 + 衬线名 + mono 曲目数） */}
        <div className="max-h-64 overflow-y-auto border-t border-hair divide-y divide-hair-soft">
          {isLoading ? (
            // loading：hair-soft 骨架行闪烁（不用 spinner，DESIGN §4.5）
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-3">
                <span className="w-6 h-3 rounded-sm bg-hair-soft animate-pulse" />
                <span className="h-3.5 flex-1 rounded-sm bg-hair-soft animate-pulse" style={{ animationDelay: `${i * 0.1}s` }} />
              </div>
            ))
          ) : playlists?.length ? (
            playlists.map((pl, i) => (
              <button
                key={pl.id}
                onClick={() => handleAdd(pl.id, pl.name)}
                disabled={addToPlaylist.isPending}
                className="w-full flex items-baseline gap-3 px-2 py-3 text-left transition-colors duration-200 hover:bg-paper-deep"
              >
                <span className="font-num text-xs text-ink-faint flex-shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-serif font-semibold text-[15px] truncate flex-1">{pl.name}</span>
                {pl.songCount !== undefined && (
                  <span className="font-num text-xs text-ink-faint flex-shrink-0">{pl.songCount} 首</span>
                )}
              </button>
            ))
          ) : (
            <p className="text-sm text-ink-faint text-center py-6">暂无歌单，可下方新建</p>
          )}
        </div>

        {/* 新建歌单 */}
        <div className="flex gap-2 pt-2 border-t border-hair">
          <Input
            placeholder="新建歌单名称"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              // isComposing / keyCode 229：中日韩输入法组词期间按 Enter 是确认候选词，不应触发创建
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) handleCreate()
            }}
          />
          <Button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            variant="outline"
            size="icon"
            title="新建并添加"
            className="flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
