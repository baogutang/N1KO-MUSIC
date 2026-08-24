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
import { useT } from '@/i18n'

export default function Playlists() {
  const { t } = useT()
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
      toast({ title: t('playlist.created', { name: newName }) })
      setShowCreate(false)
      setNewName('')
    } catch {
      toast({ title: t('playlist.createFailed'), variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function handlePlayPlaylist(playlistId: string, randomPlay = false, e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      const detail = await getAdapter().getPlaylistDetail(playlistId)
      if (!detail?.songs?.length) {
        toast({ title: t('playlist.emptyToast') })
        return
      }
      if (randomPlay) {
        playAllShuffled(detail.songs, 0)
      } else {
        playAllInOrder(detail.songs, 0)
      }
    } catch {
      toast({ title: t('playlist.loadFailed'), variant: 'destructive' })
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deletePlaylist.mutateAsync(deleteTarget.id)
      toast({ title: t('playlist.deleted', { name: deleteTarget.name }) })
    } catch {
      toast({ title: t('playlist.deleteFailed'), variant: 'destructive' })
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
            {t('nav.playlists')}
            <span className="latin-tag ml-4 align-[4px] font-sans text-[11px] font-normal tracking-[0.3em] text-ink-faint">
              PLAYLISTS
            </span>
          </h1>
          {!isLoading && (
            <p className="mt-1.5 font-num text-sm text-ink-faint">
              {t('playlist.count', { count: playlists?.length ?? 0 })}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-6">
          <button
            onClick={() => setShowImport(true)}
            className="inline-flex items-center gap-2 text-sm text-ink-soft transition-colors hover:text-primary active:scale-[0.97]"
          >
            <UploadSimple className="w-3.5 h-3.5" />
            {t('action.import')}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 text-sm font-semibold text-foreground underline decoration-hair decoration-1 underline-offset-[6px] transition-colors hover:text-primary hover:decoration-primary active:scale-[0.97]"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('empty.playlists.action')}
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
          title={t('empty.playlists.title')}
          description={t('empty.playlists.description')}
          action={{ label: t('empty.playlists.action'), onClick: () => setShowCreate(true) }}
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
                    title={t('player.shuffle')}
                    aria-label={t('player.shuffle')}
                    className="w-8 h-8 rounded-full border border-paper/80 bg-ink/25 text-paper flex items-center justify-center transition-colors hover:bg-primary hover:border-primary active:scale-[0.94]"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => handlePlayPlaylist(pl.id, false, e)}
                    title={t('player.playAll')}
                    aria-label={t('player.playAll')}
                    className="w-9 h-9 rounded-full border border-paper/80 bg-ink/25 text-paper flex items-center justify-center transition-colors hover:bg-primary hover:border-primary active:scale-[0.94]"
                  >
                    <Play className="w-3.5 h-3.5 ml-px" weight="fill" />
                  </button>
                </div>
                {/* 更多操作 */}
                <div
                  className="absolute top-2 right-2 transition-opacity duration-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100"
                  onClick={e => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label={t('action.more')}
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
                          <p className="font-serif text-sm font-semibold">{t('playlist.smart')}</p>
                          <p className="mt-1 text-xs text-ink-faint">
                            {t('playlist.smartHint')}
                          </p>
                        </div>
                      ) : (
                        <DropdownMenuItem
                          className="text-destructive gap-2"
                          onClick={() => setDeleteTarget({ id: pl.id, name: pl.name })}
                        >
                          <Trash className="w-4 h-4" />
                          {t('playlist.delete')}
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
                    <span className="font-num">{t('song.count', { count: pl.songCount })}</span>
                  )}
                  {pl.readonly && (
                    <span className="text-[10.5px] tracking-[0.14em] text-primary">{t('playlist.smartBadge')}</span>
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
            <DialogTitle>{t('empty.playlists.action')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder={t('playlist.namePlaceholder')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowCreate(false)}>{t('action.cancel')}</Button>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? t('action.creating') : t('action.create')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('playlist.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('playlist.deleteConfirmDesc', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t('action.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deletePlaylist.isPending}
            >
              {deletePlaylist.isPending ? t('action.deleting') : t('action.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ImportPlaylistDialog open={showImport} onOpenChange={setShowImport} />
    </div>
  )
}
