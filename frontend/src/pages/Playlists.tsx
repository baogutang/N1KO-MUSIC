import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ListMusic, Plus, Music2, MoreHorizontal, Trash2, Play, Shuffle } from 'lucide-react'
import { usePlaylists } from '@/hooks/useServerQueries'
import { getAdapter } from '@/api'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/use-toast'
import { usePlayerStore } from '@/store/playerStore'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default function Playlists() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: playlists, isLoading } = usePlaylists()
  const playQueue     = usePlayerStore(s => s.playQueue)
  const toggleShuffle = usePlayerStore(s => s.toggleShuffle)
  const shuffle       = usePlayerStore(s => s.shuffle)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const adapter = getAdapter()
      await adapter.createPlaylist(newName.trim())
      queryClient.invalidateQueries({ queryKey: ['playlists'] })
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
        if (!shuffle) toggleShuffle()
        playQueue(detail.songs, 0)
      } else {
        if (shuffle) toggleShuffle()
        playQueue(detail.songs, 0)
      }
    } catch {
      toast({ title: '加载歌单失败', variant: 'destructive' })
    }
  }

  return (
    <div className="min-h-full pb-8">
      <div className="px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ListMusic className="w-8 h-8 text-primary" />
            歌单
          </h1>
          <Button onClick={() => setShowCreate(true)} size="sm" className="gap-1.5">
            <Plus className="w-4 h-4" />
            新建歌单
          </Button>
        </div>

        {/* Playlist grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : !playlists?.length ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <ListMusic className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg mb-1">暂无歌单</p>
            <p className="text-sm mb-4">创建第一个歌单开始收藏喜欢的歌曲</p>
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" />
              创建歌单
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {playlists.map(pl => (
              <div
                key={pl.id}
                className="group cursor-pointer"
                onClick={() => navigate(`/playlists/${pl.id}`)}
              >
                <div className="relative aspect-square rounded-xl overflow-hidden bg-muted mb-2">
                  {pl.coverArt ? (
                    <img
                      src={pl.coverArt}
                      alt={pl.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                      <Music2 className="w-12 h-12 text-primary/40" />
                    </div>
                  )}
                  {/* 悬浮播放按鈕区 */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center gap-2">
                    <button
                      onClick={(e) => handlePlayPlaylist(pl.id, false, e)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-full text-xs font-medium hover:bg-primary/90 transition-colors shadow-lg"
                    >
                      <Play className="w-3.5 h-3.5" fill="currentColor" />
                      播放全部
                    </button>
                    <button
                      onClick={(e) => handlePlayPlaylist(pl.id, true, e)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-white/10 backdrop-blur-sm text-white rounded-full text-xs font-medium hover:bg-white/20 transition-colors"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      随机播放
                    </button>
                  </div>
                  {/* Actions */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="w-7 h-7 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors">
                          <MoreHorizontal className="w-3.5 h-3.5 text-white" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive gap-2">
                          <Trash2 className="w-4 h-4" />
                          删除歌单
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <p className="font-medium text-sm truncate">{pl.name}</p>
                {pl.songCount !== undefined && (
                  <p className="text-xs text-muted-foreground">{pl.songCount} 首歌曲</p>
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
    </div>
  )
}
