/**
 * 榜单详情（PLAN 2.3）：/toplists/:serverId/:topListId
 *
 * 插件音源的榜单（飙升榜 / 新歌榜这类）没有独立的服务端路由，
 * 由 getTopListDetail 分页取曲；这里先渲染第一页（榜单场景足够）。
 */

import { useMemo } from 'react'
import { useLocation, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Shuffle } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { useSourceTopLists, useTopListDetail } from '@/hooks/useSourceQueries'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { EmptyState } from '@/components/common/EmptyState'
import { useT } from '@/i18n'

export default function TopListDetail() {
  const { t } = useT()
  const { serverId = '', topListId = '' } = useParams<{ serverId: string; topListId: string }>()
  const sourceId = decodeURIComponent(serverId)
  const listId = decodeURIComponent(topListId)
  const navigate = useNavigate()
  const location = useLocation()
  const { data: songs, isLoading, isError, error, refetch } = useTopListDetail(sourceId, listId)

  /**
   * 标题是「飙升榜」还是「新歌榜」，用户点进来时就已经知道了——页头写死一个
   * 「榜单」等于把他刚做出的选择又抹掉一次。
   *
   * 名字有两条来路：跳转方塞进路由 state（最直接），或者从榜单列表查询里按 id
   * 找回来。后者几乎总是缓存命中：首页那排榜单用的是同一条 query（同一个 key，
   * staleTime 10 分钟），从首页点进来时它就在缓存里。
   */
  const topLists = useSourceTopLists()
  const listName = useMemo(() => {
    const fromState = (location.state as { name?: string } | null)?.name
    if (fromState) return fromState
    const group = topLists.find(g => g.serverId === sourceId)
    for (const section of group?.data?.groups ?? []) {
      const hit = section.items.find(item => item.id === listId)
      if (hit) return hit.name
    }
    return undefined
  }, [location.state, topLists, sourceId, listId])

  const backLink = (
    <button
      onClick={() => navigate(-1)}
      className="inline-flex items-center gap-2 text-[13px] text-ink-faint hover:text-primary transition-colors"
      aria-label={t('action.back')}
    >
      <ArrowLeft size={14} />
      {t('action.back')}
    </button>
  )

  const header = (
    <div className="pt-8 pb-8 border-b border-hair flex items-end gap-5">
      {backLink}
      <div className="flex-1 min-w-0">
        <h1 className="font-serif text-[28px] font-bold flex items-center gap-3">
          {listName ?? t('sources.topListDetail')}
          <SourceBadge serverId={sourceId} withName />
        </h1>
      </div>
      {songs && songs.length > 0 && (
        <div className="flex items-center gap-6 pb-1.5">
          <button
            className="more inline-flex items-center gap-1.5"
            onClick={() => playAllInOrder(songs, 0)}
          >
            <Play size={12} />
            {t('player.playAll')}
          </button>
          <button
            className="more inline-flex items-center gap-1.5"
            onClick={() => playAllShuffled(songs, 0)}
          >
            <Shuffle size={12} />
            {t('player.shuffle')}
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="animate-fade-in">
      {header}
      <div className="mt-8">
        {isLoading ? (
          /* 骨架而不是一个孤零零的省略号：省略号既说不出在等什么，
             也量不出这一页大概有多长 */
          <SongRowsSkeleton rows={10} />
        ) : isError ? (
          /* 出错和榜单为空是两件事。合在一起说的话，一次网络抖动看起来就像
             「这个榜今天没有内容」，用户既不知道该重试，也没有重试的入口。
             裸异常同理：插件抛的是英文开发者串，摆在正式界面上帮不了任何人。 */
          <EmptyState
            ruled
            title={t('error.load.title')}
            description={t('error.load.description')}
            action={{ label: t('action.retry'), onClick: () => { void refetch() } }}
          />
        ) : !songs?.length ? (
          <EmptyState
            title={t('sources.topListEmptyTitle')}
            description={t('sources.topListEmptyDesc')}
          />
        ) : (
          <SongList songs={songs} showCover showAlbum showIndex sourceBadge />
        )}
        {/* 原始异常只给开发态 */}
        {import.meta.env.DEV && isError && (
          <p className="mt-3 truncate font-mono text-[11px] text-ink-faint opacity-70">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
      </div>
    </div>
  )
}

/** 曲目加载骨架：hair-soft 行闪烁（DESIGN §4.5） */
function SongRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="border-t border-hair">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-3 border-b border-hair-soft">
          <span className="w-8 h-3 rounded-sm bg-skeleton animate-pulse" />
          <span className="w-10 h-10 rounded-sm bg-skeleton animate-pulse" />
          <span className="flex-1 h-4 rounded-sm bg-skeleton animate-pulse" />
          <span className="hidden lg:block flex-1 h-3.5 rounded-sm bg-skeleton animate-pulse" />
          <span className="w-12 h-3.5 rounded-sm bg-skeleton animate-pulse" />
        </div>
      ))}
    </div>
  )
}
