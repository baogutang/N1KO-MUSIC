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
import { CoverCard, CoverGrid } from '@/components/common/CoverCard'
import { CoverActionButton, CoverActions } from '@/components/music/AlbumCard'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { spaceCJK } from '@/utils/cjkTypography'
import { ImportPlaylistDialog } from '@/components/music/ImportPlaylistDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
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
        /* 单源分支的 status 不许写死 success（阶段 2.1）：主库失败时
           「创建第一个歌单」是在把故障说成空库。 */
        status: primary.isError ? 'error' as const
          : primary.isLoading ? 'loading' as const
          : 'success' as const,
        items: primary.data ?? [],
        // ?src= 指向别的源时这一节不是主库的：删除这类主库动作不在此提供
        //（外源歌单的删除/退订语义不同），与多源分节的判据保持一致
        isPrimary: (srcFilter ?? activeServerId) === activeServerId,
      }]
  /* 加载中不显示计数（阶段 2.1）：0 个歌单在撒谎 */
  const anyLoading = sections.some(s => s.status === 'loading')
  const totalCount = anyLoading ? -1 : sections.reduce((sum, s) => sum + s.items.length, 0)

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
    <div className="pt-2 regular:pt-4 animate-fade-in">
      {/* 页头：大标题 + 总数；右侧 导入（纸片胶囊）与 新建（强调色实心） */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">
            {t('nav.playlists')}
          </h1>
          {!isLoading && totalCount >= 0 && (
            <p className="num mt-3 text-sm text-ink-faint">
              {t('playlist.count', { count: totalCount })}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
          {/* 导入拆两项：文件（M3U/XSPF）与跨源歌单（阶段 5） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="act-secondary inline-flex items-center gap-2 text-sm">
                <UploadSimple size={15} />
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
            className="act-primary inline-flex items-center gap-2 text-sm"
          >
            <Plus size={15} weight="bold" />
            {t('empty.playlists.action')}
          </button>
        </div>
      </header>

      {/*
       * 歌单封面墙（复核 F12：骨架只在分节内显示）。
       * 多源时任一源还在加载时，已返回的分节照常呈现——注释里写着
       * 「不等最慢的」，旧实现却在 anyLoading 时用 totalCount=-1 把整页
       * 换成 12 格骨架，把已到的分节盖掉。加载中的分节自己摆骨架。
       */}
      <div className="mt-8">
      {allSourcesFailed && localPlaylists.length === 0 ? (
        <EmptyState
          title={t('sources.allFailed.title')}
          description={t('sources.allFailed.description')}
          action={{ label: t('action.retry'), onClick: () => void refetchAll() }}
        />
      ) : totalCount === 0 && localPlaylists.length === 0 && !anyLoading ? (
        <EmptyState
          ruled
          title={t('empty.playlists.title')}
          description={t('empty.playlists.description')}
          action={{ label: t('empty.playlists.action'), onClick: () => setShowCreate(true) }}
        />
      ) : (
        <>
          {/* 本地歌单存储打不开（无痕模式/配额/损坏）：明说，而不是分区无声消失 */}
          {localLoadError && (
            <p role="alert" className="mb-6 rounded-md bg-destructive/10 px-4 py-3 text-[14px] leading-relaxed text-destructive">
              {t('sources.import.localStoreError')}
            </p>
          )}

          {/* 本地混合歌单（阶段 5）：跨源曲目快照，不同步 backend */}
          {localPlaylists.length > 0 && (
            <section>
              <div className="section-head !pt-0">
                <h2 className="flex items-center gap-2.5">
                  <HardDrive className="w-4 h-4 text-ink-faint" />
                  {t('sources.import.localSection')}
                </h2>
                <span className="num text-sm text-ink-faint">
                  {t('playlist.count', { count: localPlaylists.length })}
                </span>
              </div>
              <CoverGrid>
                {localPlaylists.map(pl => (
                  <CoverCard
                    key={pl.id}
                    aria-label={pl.name}
                    onClick={() => setViewingLocal(pl.id)}
                    tile={
                      <div className="flex h-full w-full items-center justify-center">
                        <MusicNote className="h-10 w-10 text-ink-faint" />
                      </div>
                    }
                    title={spaceCJK(pl.name)}
                    meta={<span className="num">{t('song.count', { count: pl.items.length })}</span>}
                    captionExtra={
                      <p className="mt-1.5">
                        <span className="sticker px-2.5 py-0.5 text-xs">{t('playlist.localLabel')}</span>
                      </p>
                    }
                  />
                ))}
              </CoverGrid>
            </section>
          )}
          {sections.map((section, index) => (
            <section key={section.serverId} className={!multi && localPlaylists.length > 0 ? 'mt-10' : undefined}>
              {multi && (
                <div className={cn('section-head', index === 0 && localPlaylists.length === 0 && '!pt-0')}>
                  <h2 className="flex items-center gap-2.5">
                    <SourceBadge serverId={section.serverId} withName />
                  </h2>
                  {section.status === 'success' && (
                    <span className="num text-sm text-ink-faint">
                      {t('playlist.count', { count: section.items.length })}
                    </span>
                  )}
                </div>
              )}
              {section.status === 'error' && (
                <div>
                  <ErrorState retry={() => { void refetchAll() }} />
                </div>
              )}
              <CoverGrid>
                {/* 分节内骨架（复核 F12）：这一节还在加载时摆几格占位，
                    不再让整页陪着转 */}
                {section.status === 'loading' && Array.from({ length: 6 }).map((_, i) => (
                  <div key={`skeleton-${i}`} aria-hidden="true">
                    <div className="aspect-square rounded-md bg-skeleton animate-pulse" />
                    <div className="mt-3 h-4 w-3/4 rounded-sm bg-skeleton animate-pulse" />
                  </div>
                ))}
                {section.items.map(pl => {
                  const href = `/playlists/${pl.id}?src=${encodeURIComponent(pl.serverId)}`
                  return (
                    <CoverCard
                      key={`${section.serverId}:${pl.id}`}
                      aria-label={pl.name}
                      onClick={() => navigate(href)}
                      tile={
                        pl.coverArt ? (
                          <img
                            src={findAdapterFor(pl.serverId)?.getCoverUrl(pl.coverArt, 300) ?? pl.coverArt}
                            alt={pl.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <MusicNote className="h-10 w-10 text-ink-faint" />
                          </div>
                        )
                      }
                      overlay={
                        <>
                          {/* 播放 / 随机：鼠标下 hover 才浮现，触屏常显 */}
                          <CoverActions>
                            <CoverActionButton
                              small
                              onClick={e => handlePlayPlaylist(pl, true, e)}
                              title={t('player.shuffle')}
                              aria-label={t('player.shuffle')}
                            >
                              <Shuffle className="h-3.5 w-3.5" />
                            </CoverActionButton>
                            <CoverActionButton
                              onClick={e => handlePlayPlaylist(pl, false, e)}
                              title={t('player.playAll')}
                              aria-label={t('player.playAll')}
                            >
                              <Play className="h-3.5 w-3.5" weight="fill" />
                            </CoverActionButton>
                          </CoverActions>
                          {/* 更多操作 */}
                          <div
                            className="absolute right-2 top-2 transition-opacity duration-200 focus-within:opacity-100 [&:has([data-state=open])]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                            onClick={e => e.stopPropagation()}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <CoverActionButton small aria-label={t('action.more')}>
                                  <DotsThree className="h-4 w-4" weight="bold" />
                                </CoverActionButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {pl.readonly ? (
                                  // 智能歌单由服务器按规则生成，删除/编辑在它上面是无效操作，
                                  // 与其让用户点了没反应，不如说明它是什么
                                  <div className="px-3 py-2 max-w-[13rem]">
                                    <p className="font-display text-sm font-semibold">{t('playlist.smart')}</p>
                                    <p className="mt-1 text-[13px] text-ink-faint">
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
                        </>
                      }
                      title={spaceCJK(pl.name)}
                      meta={
                        pl.songCount !== undefined
                          ? <span className="num">{t('song.count', { count: pl.songCount })}</span>
                          : undefined
                      }
                      captionExtra={
                        pl.readonly ? (
                          <p className="mt-1.5">
                            <span className="sticker px-2.5 py-0.5 text-xs">{t('playlist.smart')}</span>
                          </p>
                        ) : undefined
                      }
                    />
                  )
                })}
              </CoverGrid>
            </section>
          ))}
        </>
      )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('empty.playlists.action')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <Input
              placeholder={t('playlist.namePlaceholder')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => {
                /* 组词中的 Enter 是确认候选词，不是提交（阶段 2.5） */
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) handleCreate()
              }}
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
        <DialogContent className="max-w-sm">
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
            <span className="num text-[13px] font-normal text-ink-faint">
              {t('song.trackCount', { count: songs.length })}
            </span>
          </DialogTitle>
          <DialogDescription>{t('playlist.localLabel')}</DialogDescription>
        </DialogHeader>
        {songs.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-ink-faint">{t('sources.import.localEmpty')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <Button size="sm" onClick={() => playAllInOrder(songs, 0)}>
              <Play size={14} weight="fill" />
              {t('player.playAll')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => playAllShuffled(songs, 0)}>
              <Shuffle size={14} />
              {t('player.shuffle')}
            </Button>
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
