import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, MusicNote, DotsThree, Trash, Play, Shuffle, UploadSimple, HardDrive } from '@phosphor-icons/react'
import { usePlaylists, useDeletePlaylist, queryKeys } from '@/hooks/useServerQueries'
import { useConnectedSources, useSourcePlaylists } from '@/hooks/useSourceQueries'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { ImportFromSourceDialog } from '@/components/sources/ImportFromSourceDialog'
import { useLocalPlaylistStore, type LocalPlaylist } from '@/store/localPlaylistStore'
import { SongList } from '@/components/music/SongList'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { findAdapterFor, getAdapter, getAdapterFor } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/use-toast'
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
import { sourceParam } from '@/lib/sourceParam'

export default function Playlists() {
  const { t } = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const srcFilter = sourceParam(searchParams)
  const sources = useConnectedSources()
  const multi = sources.length > 1 && !srcFilter
  // 多源：每源一节（主库节带新建/导入与删除）；单源/?src=：一条查询，行为同旧版。
  // ?src= 时这条查询必须打那个源：不传来源等于在「网易云」这一节里摆主库的歌单，
  // 点进去还会跳到一个不存在的歌单详情。
  const primary = usePlaylists(srcFilter)
  const grouped = useSourcePlaylists()
  const deletePlaylist = useDeletePlaylist()
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showImportSource, setShowImportSource] = useState(false)
  const [viewingLocal, setViewingLocal] = useState<string | null>(null)
  const localPlaylists = useLocalPlaylistStore(s => s.playlists)
  const localLoad = useLocalPlaylistStore(s => s.load)
  const localRemove = useLocalPlaylistStore(s => s.remove)
  const localLoadError = useLocalPlaylistStore(s => s.loadError)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; serverId: string } | null>(null)

  useEffect(() => { void localLoad() }, [localLoad])

  const activeServerId = useServerStore(s => s.activeServerId)
  /*
   * 多源下**不等最慢的那个**：NAS 秒回却要陪网易云一起转骨架，是计划里
   * 明确要避免的。只有一个源都还没结果时才算整页加载中，其余交给分节各自呈现。
   */
  const isLoading = multi
    ? grouped.length > 0 && grouped.every(g => g.status === 'loading')
    : primary.isLoading
  /* 全部源都失败 ≠ 你没有歌单。这两件事此前长得一模一样，
     用户被告知「创建第一个歌单吧」，而真相是三个源都挂了。 */
  const allSourcesFailed = multi && grouped.length > 0 && grouped.every(g => g.status === 'error')
  /* 重试按谓词失效：聚合查询的键是 [serverId, 'playlists']，
     用前缀 ['playlists'] 一个都匹配不上（搜索页那个按钮就是这么失灵的）*/
  const refetchAll = () =>
    queryClient.invalidateQueries({ predicate: q => q.queryKey[1] === 'playlists' })
  const sections = multi
    ? grouped.map(g => ({
        serverId: g.serverId,
        name: g.name,
        status: g.status,
        items: g.data ?? [],
        isPrimary: g.serverId === activeServerId,
      }))
    : [{
        serverId: srcFilter ?? activeServerId ?? '',
        name: sources.find(s => s.serverId === (srcFilter ?? activeServerId))?.name ?? '',
        status: 'success' as const,
        items: primary.data ?? [],
        // ?src= 指向别的源时这一节不是主库的：删除这类主库动作不在此提供
        //（外源歌单的删除/退订语义不同），与多源分节的判据保持一致
        isPrimary: (srcFilter ?? activeServerId) === activeServerId,
      }]
  const totalCount = sections.reduce((sum, s) => sum + s.items.length, 0)

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

  async function handlePlayPlaylist(playlist: { id: string; serverId: string }, randomPlay = false, e?: React.MouseEvent) {
    e?.stopPropagation()
    try {
      const detail = await getAdapterFor(playlist.serverId).getPlaylistDetail(playlist.id)
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
      // 带上歌单自己的来源：删除请求必须发给它所在的服务器，不是主库
      await deletePlaylist.mutateAsync({ playlistId: deleteTarget.id, serverId: deleteTarget.serverId })
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
              {t('playlist.count', { count: totalCount })}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-6">
          {/* 导入拆两项：文件（M3U/XSPF）与跨源歌单（阶段 5） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center gap-2 text-sm text-ink-soft transition-colors hover:text-primary active:scale-[0.97]"
              >
                <UploadSimple className="w-3.5 h-3.5" />
                {t('action.import')}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowImport(true)}>
                <UploadSimple className="w-4 h-4" />
                {t('playlist.import.title')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowImportSource(true)}>
                <HardDrive className="w-4 h-4" />
                {t('sources.import.title')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
      ) : allSourcesFailed && localPlaylists.length === 0 ? (
        <EmptyState
          title={t('sources.allFailed.title')}
          description={t('sources.allFailed.description')}
          action={{ label: t('action.retry'), onClick: () => void refetchAll() }}
        />
      ) : totalCount === 0 && localPlaylists.length === 0 ? (
        <EmptyState
          title={t('empty.playlists.title')}
          description={t('empty.playlists.description')}
          action={{ label: t('empty.playlists.action'), onClick: () => setShowCreate(true) }}
        />
      ) : (
        <>
        {/* 本地歌单存储打不开（无痕模式/配额/损坏）：明说，而不是分区无声消失 */}
      {localLoadError && (
        <p className="mt-6 border-l-2 border-destructive pl-3 text-[13px] leading-relaxed text-destructive">
          {t('sources.import.localStoreError')}
        </p>
      )}

      {/* 本地混合歌单（阶段 5）：跨源曲目快照，不同步 backend */}
        {localPlaylists.length > 0 && (
          <section className="mt-10">
            <div className="section-head">
              <h2 className="flex items-center gap-2.5">
                <HardDrive className="w-4 h-4 text-ink-faint" />
                {t('sources.import.localSection')}
              </h2>
              <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                {t('playlist.count', { count: localPlaylists.length })}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-8">
              {localPlaylists.map(pl => (
                <div
                  key={pl.id}
                  className="group cursor-pointer min-w-0"
                  onClick={() => setViewingLocal(pl.id)}
                >
                  <div className="relative mb-2.5">
                    <div className="aspect-square rounded-md ring-1 ring-hair-soft bg-paper-deep transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:shadow-float flex items-center justify-center pop:border pop:border-hair pop:ring-0">
                      <MusicNote className="w-10 h-10 text-ink-faint/50" />
                    </div>
                  </div>
                  <div className="min-w-0 px-0.5">
                    <p className="font-serif font-semibold text-[15px] leading-snug truncate transition-colors group-hover:text-primary">
                      {spaceCJK(pl.name)}
                    </p>
                    <p className="mt-0.5 flex items-baseline gap-2 text-xs text-ink-faint">
                      <span className="font-num">{t('song.count', { count: pl.items.length })}</span>
                      <span className="text-[10.5px] tracking-[0.14em] text-primary">{t('sources.import.localBadge')}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {sections.map(section => (
          <section key={section.serverId} className="mt-10">
            {multi && (
              <div className="section-head">
                <h2 className="flex items-center gap-2.5">
                  <SourceBadge serverId={section.serverId} withName />
                </h2>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('playlist.count', { count: section.items.length })}
                </span>
              </div>
            )}
            {section.status === 'error' && (
              <p className="py-3 text-[13px] text-ink-faint border-t border-hair">{t('sources.loadError')}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-8">
              {section.items.map(pl => (
            <div
              key={`${section.serverId}:${pl.id}`}
              className="group cursor-pointer min-w-0"
              onClick={() => navigate(`/playlists/${pl.id}?src=${encodeURIComponent(pl.serverId)}`)}
            >
              {/* 封面：发丝 ring，hover 微放大 + 唯一允许的淡投影 */}
              <div className="relative mb-2.5">
                <div className="aspect-square overflow-hidden rounded-md ring-1 ring-hair-soft bg-paper-deep transition-all duration-300 ease-out group-hover:scale-[1.03] group-hover:shadow-float">
                  {pl.coverArt ? (
                    <img
                      src={pl.coverArt ? (findAdapterFor(pl.serverId)?.getCoverUrl(pl.coverArt, 300) ?? pl.coverArt) : pl.coverArt}
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
                    onClick={(e) => handlePlayPlaylist(pl, true, e)}
                    title={t('player.shuffle')}
                    aria-label={t('player.shuffle')}
                    className="w-8 h-8 rounded-full border border-paper/80 bg-ink/25 text-paper flex items-center justify-center transition-colors hover:bg-primary hover:border-primary active:scale-[0.94]"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => handlePlayPlaylist(pl, false, e)}
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
                      ) : section.isPrimary ? (
                        // 删除走主库适配器；外源歌单的删除/退订语义不同，不在此提供
                        <DropdownMenuItem
                          className="text-destructive gap-2"
                          onClick={() => setDeleteTarget({ id: pl.id, name: pl.name, serverId: pl.serverId })}
                        >
                          <Trash className="w-4 h-4" />
                          {t('playlist.delete')}
                        </DropdownMenuItem>
                      ) : null}
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
          </section>
        ))}
        </>
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
      <ImportFromSourceDialog open={showImportSource} onOpenChange={setShowImportSource} />

      {/* 本地混合歌单查看（阶段 5）：播放 / 删除，曲目来自快照 */}
      <LocalPlaylistViewDialog
        playlist={localPlaylists.find(p => p.id === viewingLocal) ?? null}
        onClose={() => setViewingLocal(null)}
        onDelete={async id => {
          await localRemove(id)
          setViewingLocal(null)
        }}
      />
    </div>
  )
}

function LocalPlaylistViewDialog({
  playlist,
  onClose,
  onDelete,
}: {
  playlist: LocalPlaylist | null
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const { t } = useT()
  const songs = (playlist?.items ?? []).map(i => i.song)
  if (!playlist) return null
  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <HardDrive className="w-4 h-4 text-ink-faint" />
            {playlist.name}
            <span className="num text-[11px] font-normal text-ink-faint">
              {t('song.trackCount', { count: songs.length })}
            </span>
          </DialogTitle>
          <DialogDescription>{t('sources.import.localBadge')}</DialogDescription>
        </DialogHeader>
        {songs.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-faint">{t('sources.import.localEmpty')}</p>
        ) : (
          <div className="flex items-center gap-5 pb-2">
            <button className="more inline-flex items-center gap-1.5" onClick={() => playAllInOrder(songs, 0)}>
              <Play size={12} />
              {t('player.playAll')}
            </button>
            <button className="more inline-flex items-center gap-1.5" onClick={() => playAllShuffled(songs, 0)}>
              <Shuffle size={12} />
              {t('player.shuffle')}
            </button>
          </div>
        )}
        {songs.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto">
            <SongList songs={songs} showCover showAlbum showIndex sourceBadge />
          </div>
        )}
        <div className="flex justify-end gap-3 pt-1">
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={() => { void onDelete(playlist.id) }}
          >
            <Trash className="w-4 h-4" />
            {t('playlist.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
