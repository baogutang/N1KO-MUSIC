import { useState } from 'react'
import { ListMusic, Plus, Loader2 } from 'lucide-react'
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
        <div className="space-y-3 pt-1 max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : playlists?.length ? (
            playlists.map(pl => (
              <button
                key={pl.id}
                onClick={() => handleAdd(pl.id, pl.name)}
                disabled={addToPlaylist.isPending}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left"
              >
                <ListMusic className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium truncate">{pl.name}</span>
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">暂无歌单，可下方新建</p>
          )}
        </div>
        <div className="flex gap-2 pt-2 border-t border-border">
          <Input
            placeholder="新建歌单名称"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <Button onClick={handleCreate} disabled={creating || !newName.trim()} size="icon" title="新建并添加">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
