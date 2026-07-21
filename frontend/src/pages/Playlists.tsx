import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Queue, Plus, MusicNote, DotsThree, Trash, Play, Shuffle } from '@phosphor-icons/react'
import { usePlaylists, useDeletePlaylist, queryKeys } from '@/hooks/useServerQueries'
import { getAdapter, hasAdapter } from '@/api'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/use-toast'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default function Playlists() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: playlists, isLoading } = usePlaylists()
  const deletePlaylist = useDeletePlaylist()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const adapter = getAdapter()
      await adapter.createPlaylist(newName.trim())
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists() })
      toast({ title: `歌单"${newName}"已创建` })
      setShowCreate(false)
      setNewName('')
    } catch {
      toast({ title: '创建失败', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function handlePlayPlaylist(playlistId: string, randomPlay = false, e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      const detail = await getAdapter().getPlaylistDetail(playlistId)
      if (!detail?.songs?.length) {
        toast({ title: '歌单为空' })
        return
      }
      if (randomPlay) {
        playAllShuffled(detail.songs, 0)
      } else {
        playAllInOrder(detail.songs, 0)
      }
    } catch {
      toast({ title: '加载歌单失败', variant: 'destructive' })
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deletePlaylist.mutateAsync(deleteTarget.id)
      toast({ title: `歌单"${deleteTarget.name}"已删除` })
    } catch {
      toast({ title: '删除失败', variant: 'destructive' })
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="min-h-full pb-8 animate-fade-in">
      <div className="px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold tracking-tight">歌单</h1>
          <Button onClick={() => setShowCreate(true)} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" />
            新建歌单
          </Button>
        </div>

        {/* Playlist grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-accent animate-pulse" />
            ))}
          </div>
        ) : !playlists?.length ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-t border-border">
            <Queue className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg mb-1">暂无歌单</p>
            <p className="text-sm mb-4">创建第一个歌单开始收藏喜欢的歌曲</p>
            <Button onClick={() => setShowCreate(true)} size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              创建歌单
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-5 gap-y-6">
            {playlists.map(pl => (
              <div
                key={pl.id}
                className="group cursor-pointer min-w-0"
                onClick={() => navigate(`/playlists/${pl.id}`)}
              >
                <div className="relative aspect-square rounded-lg overflow-hidden ring-1 ring-border bg-accent mb-2.5 transition-all duration-300 ease-out group-hover:-translate-y-1 group-hover:shadow-xl">
                  {pl.coverArt ? (
                    <img
                      src={hasAdapter() ? getAdapter().getCoverUrl(pl.coverArt, 300) : pl.coverArt}
                      alt={pl.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                      <MusicNote className="w-12 h-12 text-primary/40" />
                    </div>
                  )}
                  {/* 悬浮播放按鈕区 */}
                  <div className="absolute right-2.5 bottom-2.5 flex items-center gap-2 opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 ease-out">
                    <button
                      onClick={(e) => handlePlayPlaylist(pl.id, true, e)}
                      title="随机播放"
                      className="w-8 h-8 rounded-full bg-card/80 backdrop-blur-sm border border-border text-foreground flex items-center justify-center hover:text-primary transition-colors active:scale-[0.94] shadow-lg"
                    >
                      <Shuffle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => handlePlayPlaylist(pl.id, false, e)}
                      title="播放全部"
                      className="w-[38px] h-[38px] rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:brightness-110 transition-all active:scale-[0.94] shadow-lg"
                    >
                      <Play className="w-4 h-4" weight="fill" />
                    </button>
                  </div>
                  {/* Actions */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="w-7 h-7 bg-card/80 backdrop-blur-sm border border-border rounded-full flex items-center justify-center text-foreground hover:bg-accent transition-colors active:scale-[0.94]">
                          <DotsThree className="w-4 h-4" weight="bold" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive gap-2"
                          onClick={() => setDeleteTarget({ id: pl.id, name: pl.name })}
                        >
                          <Trash className="w-4 h-4" />
                          删除歌单
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <p className="font-semibold text-[13px] truncate">{pl.name}</p>
                {pl.songCount !== undefined && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-num">{pl.songCount}</span> 首歌曲
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建歌单</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder="歌单名称"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? '创建中...' : '创建'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除歌单？</DialogTitle>
            <DialogDescription>
              歌单"{deleteTarget?.name}"将被删除，此操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deletePlaylist.isPending}
            >
              {deletePlaylist.isPending ? '删除中...' : '删除'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
