import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, MusicNote, DotsThree, Trash, Play, Shuffle, UploadSimple } from '@phosphor-icons/react'
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
import { spaceCJK } from '@/utils/cjkTypography'
import { ImportPlaylistDialog } from '@/components/music/ImportPlaylistDialog'
import { EmptyState } from '@/components/common/EmptyState'

export default function Playlists() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: playlists, isLoading } = usePlaylists()
  const deletePlaylist = useDeletePlaylist()
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
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
    <div className="pt-8 animate-fade-in">
      {/* 页头：衬线标题 + mono 总数 + 文字级主操作（DESIGN v2 §3/§4.1） */}
      <header className="flex items-end justify-between gap-6 border-b border-hair pb-6">
        <div>
          <h1 className="font-serif text-[30px] font-bold leading-tight tracking-[-0.01em]">
            歌单
            <span className="ml-4 align-[4px] font-sans text-[11px] font-normal tracking-[0.3em] text-ink-faint">
              PLAYLISTS
            </span>
          </h1>
          {!isLoading && (
            <p className="mt-1.5 text-sm text-ink-faint">
              <span className="font-num">{playlists?.length ?? 0}</span> 个歌单
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-6">
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 text-sm text-ink-soft transition-colors hover:text-primary active:scale-[0.97]"
          >
            <UploadSimple className="w-3.5 h-3.5" />
            导入
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground underline decoration-hair decoration-1 underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary active:scale-[0.97]"
          >
            <Plus className="w-3.5 h-3.5" />
            新建歌单
          </button>
        </div>
      </header>

      {/* 歌单封面墙：去卡片盒，封面即内容（DESIGN v2 §3） */}
      {isLoading ? (
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-8">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-square rounded-md bg-paper-deep animate-pulse" />
              <div className="mt-2.5 h-4 w-3/4 rounded-sm bg-paper-deep animate-pulse" />
              <div className="mt-1.5 h-3 w-1/3 rounded-sm bg-paper-deep animate-pulse" />
            </div>
          ))}
        </div>
      ) : !playlists?.length ? (
        <EmptyState
          title="这一页还空着。"
          description="创建第一个歌单，把喜欢的歌收进来。"
          action={{ label: '新建歌单', onClick: () => setShowCreate(true) }}
        />
      ) : (
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-8">
          {playlists.map(pl => (
            <div
              key={pl.id}
              className="group cursor-pointer min-w-0"
              onClick={() => navigate(`/playlists/${pl.id}`)}
            >
              {/* 封面：发丝 ring，hover 微放大 + 唯一允许的淡投影 */}
              <div className="relative mb-2.5">
                <div className="aspect-square overflow-hidden rounded-md ring-1 ring-hair-soft bg-paper-deep transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:shadow-float">
                  {pl.coverArt ? (
                    <img
                      src={hasAdapter() ? getAdapter().getCoverUrl(pl.coverArt, 300) : pl.coverArt}
                      alt={pl.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <MusicNote className="w-10 h-10 text-ink-faint/50" />
                    </div>
                  )}
                </div>
                {/* hover 浮现细线圆播放键 / 随机键（不做实心色块） */}
                <div className="absolute right-2.5 bottom-2.5 flex items-center gap-2 opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200">
                  <button
                    onClick={(e) => handlePlayPlaylist(pl.id, true, e)}
                    title="随机播放"
                    aria-label="随机播放"
                    className="w-8 h-8 rounded-full border border-paper/80 bg-ink/25 text-paper flex items-center justify-center transition-colors hover:bg-primary hover:border-primary active:scale-[0.94]"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => handlePlayPlaylist(pl.id, false, e)}
                    title="播放全部"
                    aria-label="播放全部"
                    className="w-9 h-9 rounded-full border border-paper/80 bg-ink/25 text-paper flex items-center justify-center transition-colors hover:bg-primary hover:border-primary active:scale-[0.94]"
                  >
                    <Play className="w-3.5 h-3.5 ml-px" weight="fill" />
                  </button>
                </div>
                {/* 更多操作 */}
                <div
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  onClick={e => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label="更多操作"
                        className="w-7 h-7 rounded-full border border-paper/80 bg-ink/25 text-paper flex items-center justify-center transition-colors hover:bg-primary hover:border-primary active:scale-[0.94]"
                      >
                        <DotsThree className="w-4 h-4" weight="bold" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {pl.readonly ? (
                        // 智能歌单由服务器按规则生成，删除/编辑在它上面是无效操作，
                        // 与其让用户点了没反应，不如说明它是什么
                        <div className="px-3 py-2 max-w-[13rem]">
                          <p className="font-serif text-sm font-semibold">智能歌单</p>
                          <p className="mt-1 text-xs text-ink-faint">
                            由服务器按规则自动维护，内容会自行更新，客户端不能修改。
                          </p>
                        </div>
                      ) : (
                        <DropdownMenuItem
                          className="text-destructive gap-2"
                          onClick={() => setDeleteTarget({ id: pl.id, name: pl.name })}
                        >
                          <Trash className="w-4 h-4" />
                          删除歌单
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* 图注：衬线歌单名 + mono 小字曲目数 */}
              <div className="min-w-0 px-0.5">
                <p className="font-serif font-semibold text-[15px] leading-snug truncate transition-colors group-hover:text-primary">
                  {spaceCJK(pl.name)}
                </p>
                <p className="mt-0.5 flex items-baseline gap-2 text-xs text-ink-faint">
                  {pl.songCount !== undefined && (
                    <span><span className="font-num">{pl.songCount}</span> 首</span>
                  )}
                  {pl.readonly && (
                    <span className="text-[10.5px] tracking-[0.14em] text-primary">智能 · 自动更新</span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

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

      <ImportPlaylistDialog open={showImport} onOpenChange={setShowImport} />
    </div>
  )
}
