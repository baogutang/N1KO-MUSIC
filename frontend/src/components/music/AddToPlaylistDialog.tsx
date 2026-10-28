/**
 * 「加入歌单」。
 *
 * 多源聚合下这个对话框要回答的问题变了：不是「主库有哪些歌单」，而是
 * **这几首歌能进哪些歌单**。歌单 id 与曲目 id 都只在自己那个音源里有意义，
 * 所以服务端歌单一律按曲目来源分组列出，且只列声明了 playlistWrite 的源。
 *
 * 曲目跨源时没有任何一个服务端歌单收得下（各家 id 空间不通），此时把
 * 本地混合歌单提为默认动作，并用一句**看得见的话**说明原因——原来这条理由
 * 藏在 title 属性里，触屏上根本读不到，用户只看到一排灰掉的歌单。
 */

import { useEffect, useMemo, useState } from 'react'
import { ErrorState } from '@/components/common/ErrorState'
import { useQueryClient } from '@tanstack/react-query'
import { HardDrive, Info, Plus } from '@phosphor-icons/react'
import { findAdapterFor } from '@/api'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { useCreatePlaylist, useAddToPlaylist } from '@/hooks/useServerQueries'
import {
  useSourceCapabilities,
  useSourcePlaylists,
  type SourceQueryGroup,
} from '@/hooks/useSourceQueries'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { useLocalPlaylistStore } from '@/store/localPlaylistStore'
import { useServerStore } from '@/store/serverStore'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import type { Playlist, Song, SourceCapabilities } from '@/api/types'

/** 列表行：与「接下来」同一个样子——封面 + 名字 + 数量，hover 铺一层墨色淡底，不画线 */
const ROW_CLASS =
  'press-pop group flex min-h-12 w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left hover:bg-ink/[0.06] disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent'
const THUMB_CLASS = 'cover-frame h-10 w-10 flex-none rounded-[9px] shadow-sm group-disabled:opacity-50'
const SECTION_LABEL = 'px-3 pb-1 pt-3 text-[13px] font-semibold text-ink-3'

interface AddToPlaylistDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  songs: Song[]
}

/** 某个音源下可写的服务端歌单 */
export interface WritablePlaylistSection {
  serverId: string
  status: 'loading' | 'success' | 'error'
  playlists: Playlist[]
}

/** 新建歌单的默认落点 */
export type PlaylistCreateTarget =
  | { kind: 'local' }
  | { kind: 'server'; serverId: string }

export interface PlaylistTargetPlan {
  /** 所选曲目涉及的音源（去重保序；没带来源的旧数据算作主库） */
  sourceIds: string[]
  /** 曲目跨了多个源：服务端歌单一律收不下 */
  crossSource: boolean
  /** 曲目同源时那个源的 id，否则 null */
  singleSourceId: string | null
  /** 按曲目来源列出的可写歌单分区 */
  sections: WritablePlaylistSection[]
  /** 回车与「新建」按钮的默认落点 */
  defaultCreate: PlaylistCreateTarget
}

/**
 * 算出这几首歌能进哪些歌单（纯函数，测试直接覆盖）。
 *
 * 规则：
 *  - 曲目全来自同一个源，且那个源能写歌单 → 默认动作是**该源的服务端歌单**；
 *  - 曲目跨源，或那个源不能写 → 默认动作是本地混合歌单；
 *  - 只列曲目实际涉及的源，且滤掉只读的智能歌单（服务器按规则生成，加不进去）。
 */
export function resolvePlaylistTargets(
  songs: Song[],
  primaryServerId: string | null,
  groups: SourceQueryGroup<Playlist[]>[],
  caps: Record<string, SourceCapabilities>
): PlaylistTargetPlan {
  const sourceIds: string[] = []
  for (const song of songs) {
    // 早期数据没带来源，那时候「主库」就是唯一的源
    const id = song.serverId || primaryServerId || ''
    if (id && !sourceIds.includes(id)) sourceIds.push(id)
  }
  const crossSource = sourceIds.length > 1
  const singleSourceId = sourceIds.length === 1 ? sourceIds[0] : null

  const sections: WritablePlaylistSection[] = []
  for (const serverId of sourceIds) {
    if (!caps[serverId]?.playlistWrite) continue
    const group = groups.find(g => g.serverId === serverId)
    if (!group) continue
    sections.push({
      serverId,
      status: group.status,
      playlists: (group.data ?? []).filter(pl => !pl.readonly),
    })
  }

  const canWriteSingle = !!singleSourceId && !!caps[singleSourceId]?.playlistWrite
  return {
    sourceIds,
    crossSource,
    singleSourceId,
    sections,
    defaultCreate: !crossSource && canWriteSingle
      ? { kind: 'server', serverId: singleSourceId! }
      : { kind: 'local' },
  }
}

export function AddToPlaylistDialog(props: AddToPlaylistDialogProps) {
  /*
   * 这个对话框在每个歌曲列表里都常驻挂载（SongList 里就有两个实例），
   * 而它现在要向**每个**音源要歌单。首次打开前不挂载查询体，否则开一页列表
   * 就等于对所有音源各打一次歌单请求。开过一次之后保持挂载，关闭动画才不会被吞掉。
   */
  const [everOpened, setEverOpened] = useState(props.open)
  useEffect(() => { if (props.open) setEverOpened(true) }, [props.open])
  if (!everOpened) return null
  return <AddToPlaylistDialogBody {...props} />
}

function AddToPlaylistDialogBody({ open, onOpenChange, songs }: AddToPlaylistDialogProps) {
  const { t } = useT()
  const addToPlaylist = useAddToPlaylist()
  const createPlaylist = useCreatePlaylist()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  // 本地混合歌单：跨源曲目的唯一安全去处（服务端歌单只认自己源的 id）
  const localPlaylists = useLocalPlaylistStore(s => s.playlists)
  const localLoaded = useLocalPlaylistStore(s => s.loaded)
  const localLoad = useLocalPlaylistStore(s => s.load)
  const createLocal = useLocalPlaylistStore(s => s.create)
  const addSongsToLocal = useLocalPlaylistStore(s => s.addSongs)
  const primaryServerId = useServerStore(s => s.activeServerId)

  const groups = useSourcePlaylists()
  const queryClient = useQueryClient()
  /** 分节加载失败的重试：失效各源的 playlists 族（阶段 7.1） */
  const refetchSections = () =>
    Promise.all(groups
      .map(g => queryClient.invalidateQueries({ queryKey: [g.serverId, 'playlists'] })))
  const caps = useSourceCapabilities()
  const plan = useMemo(
    () => resolvePlaylistTargets(songs, primaryServerId, groups, caps),
    [songs, primaryServerId, groups, caps]
  )

  useEffect(() => {
    if (open && !localLoaded) void localLoad().catch(() => { /* 分区拿不到就不列，不让加歌流程挂掉 */ })
  }, [open, localLoaded, localLoad])

  const songIds = songs.map(s => s.id)
  const serverCreateId = plan.defaultCreate.kind === 'server' ? plan.defaultCreate.serverId : null

  async function handleAdd(serverId: string, playlistId: string, playlistName: string) {
    try {
      // 打歌单自己那个源；写死主库时「加入网易云歌单」会发到 NAS 上
      await addToPlaylist.mutateAsync({ playlistId, songIds, serverId })
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

  async function handleCreateOnServer(serverId: string) {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      await createPlaylist.mutateAsync({ name, songIds, serverId })
      toast({ title: t('playlist.createdWithSongs', { name }) })
      setNewName('')
      onOpenChange(false)
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

  /** 回车走默认落点：同源时是那个源的服务端歌单，跨源时是本地混合歌单 */
  function handleDefaultCreate() {
    if (serverCreateId) void handleCreateOnServer(serverCreateId)
    else void handleCreateLocal()
  }

  const localSection = localPlaylists.length > 0 && (
    <>
      <p className={SECTION_LABEL}>
        {t('sources.import.localSection')}
      </p>
      {localPlaylists.map(pl => (
        <button
          key={pl.id}
          onClick={() => handleAddLocal(pl.id, pl.name)}
          className={ROW_CLASS}
        >
          <span className={cn(THUMB_CLASS, 'grid place-items-center bg-ink/[0.06] text-ink-2')}>
            <HardDrive size={18} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{pl.name}</span>
          <span className="num flex-none text-[13px] text-ink-3">
            {t('playlist.songCount', { count: pl.items.length })}
          </span>
        </button>
      ))}
    </>
  )

  const serverSections = (
    <>
      {plan.sections.map(section => (
        <div key={section.serverId}>
          <p className={cn(SECTION_LABEL, 'flex items-center gap-2')}>
            <SourceBadge serverId={section.serverId} withName />
          </p>
          {section.status === 'loading' ? (
            // loading：骨架行（封面块 + 名字条），不用 spinner
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex min-h-12 items-center gap-3 px-3 py-2">
                <span className="skeleton h-10 w-10 flex-none rounded-[9px]" style={{ animationDelay: `${i * 0.1}s` }} />
                <span className="skeleton h-3.5 flex-1 rounded-sm" style={{ animationDelay: `${i * 0.1}s` }} />
              </div>
            ))
          ) : section.status === 'error' ? (
            <ErrorState ruled={false} className="py-8" retry={() => { void refetchSections() }} />
          ) : section.playlists.length ? (
            section.playlists.map(pl => {
              const cover = pl.coverArt ? findAdapterFor(pl.serverId)?.getCoverUrl(pl.coverArt, 80) ?? undefined : undefined
              return (
                <button
                  key={pl.id}
                  onClick={() => handleAdd(section.serverId, pl.id, pl.name)}
                  disabled={addToPlaylist.isPending || plan.crossSource}
                  className={ROW_CLASS}
                >
                  <span className={THUMB_CLASS}>
                    <ImageWithFallback src={cover} alt="" fallbackType="album" className="h-full w-full" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{pl.name}</span>
                  {pl.songCount !== undefined && (
                    <span className="num flex-none text-[13px] text-ink-3">
                      {t('playlist.songCount', { count: pl.songCount })}
                    </span>
                  )}
                </button>
              )
            })
          ) : (
            <p className="px-3 py-4 text-[14px] text-ink-3">{t('playlist.noneYet')}</p>
          )}
        </div>
      ))}
      {/* 这个源根本不能写歌单：说清楚，而不是留一片空白让人以为还在加载 */}
      {!plan.crossSource && plan.singleSourceId !== null && plan.defaultCreate.kind === 'local' && (
        <p className="px-3 py-4 text-[13.5px] leading-relaxed text-ink-3">
          {t('playlist.sourceNoWrite')}
        </p>
      )}
    </>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('action.addToPlaylist')}</DialogTitle>
        </DialogHeader>

        {/* 跨源的理由必须看得见：藏在 title 里等于没说（触屏根本读不到） */}
        {plan.crossSource && (
          <p className="flex items-start gap-2.5 rounded-md bg-fill px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
            <Info size={17} weight="fill" aria-hidden="true" className="mt-0.5 flex-none text-ink-3" />
            <span>{t('playlist.localOnlyHint', { count: plan.sourceIds.length })}</span>
          </p>
        )}

        {/* 列表不画分隔线：靠行高与 hover 底区分 */}
        <div className="-mx-2 max-h-72 overflow-y-auto">
          {/* 跨源时本地歌单排在前面：它是这一次唯一收得下的去处 */}
          {plan.crossSource ? <>{localSection}{serverSections}</> : <>{serverSections}{localSection}</>}
        </div>

        {/* 新建：本地（跨源安全）与该源的服务端歌单两个出口；默认落点是那枚青柠键 */}
        <div className="flex items-center gap-2 pt-1">
          <Input
            placeholder={t('playlist.namePlaceholder')}
            value={newName}
            className="min-w-0 flex-1"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              // isComposing / keyCode 229：中日韩输入法组词期间按 Enter 是确认候选词，不应触发创建
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
                handleDefaultCreate()
              }
            }}
          />
          <Button
            onClick={() => void handleCreateLocal()}
            disabled={creating || !newName.trim()}
            variant={serverCreateId ? 'secondary' : 'default'}
            size="icon"
            aria-label={t('playlist.createLocal')}
            title={t('playlist.createLocal')}
            className="h-11 w-11 flex-none"
          >
            <HardDrive size={18} />
          </Button>
          {serverCreateId && (
            <Button
              onClick={() => void handleCreateOnServer(serverCreateId)}
              disabled={creating || !newName.trim()}
              variant="default"
              size="icon"
              aria-label={t('playlist.createAndAdd')}
              title={t('playlist.createAndAdd')}
              className="h-11 w-11 flex-none"
            >
              <Plus size={18} weight="bold" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
