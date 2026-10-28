/**
 * 榜单详情（PLAN 2.3）：/toplists/:serverId/:topListId
 *
 * 插件音源的榜单（飙升榜 / 新歌榜这类）没有独立的服务端路由，
 * 由 getTopListDetail 分页取曲；这里先渲染第一页（榜单场景足够）。
 */

import { useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { Play, Shuffle } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { DetailHero } from '@/components/common/DetailHero'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { Button } from '@/components/ui/button'
import { useSourceTopLists, useTopListDetail } from '@/hooks/useSourceQueries'
import { useCoverUrl } from '@/hooks/useCoverUrl'
import { findAdapterFor } from '@/api'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { EmptyState } from '@/components/common/EmptyState'
import { SongRowsSkeleton } from '@/components/common/SongRowsSkeleton'
import { ErrorState } from '@/components/common/ErrorState'
import { useT } from '@/i18n'

export default function TopListDetail() {
  const { t } = useT()
  const { serverId = '', topListId = '' } = useParams<{ serverId: string; topListId: string }>()
  const sourceId = decodeURIComponent(serverId)
  const listId = decodeURIComponent(topListId)
  const location = useLocation()
  const { data: songs, isLoading, isError, error, refetch } = useTopListDetail(sourceId, listId)

  /**
   * 标题是「飙升榜」还是「新歌榜」，用户点进来时就已经知道了——页头写死一个
   * 「榜单」等于把他刚做出的选择又抹掉一次。
   *
   * 名字有两条来路：跳转方塞进路由 state（最直接），或者从榜单列表查询里按 id
   * 找回来。后者几乎总是缓存命中：首页那排榜单用的是同一条 query（同一个 key，
   * staleTime 10 分钟），从首页点进来时它就在缓存里。
   * 找回来的整条榜单项也带着榜单自己的封面，页头的大封面用它。
   */
  const topLists = useSourceTopLists()
  const listItem = useMemo(() => {
    const group = topLists.find(g => g.serverId === sourceId)
    for (const section of group?.data?.groups ?? []) {
      const hit = section.items.find(item => item.id === listId)
      if (hit) return hit
    }
    return undefined
  }, [topLists, sourceId, listId])
  const fromState = (location.state as { name?: string } | null)?.name
  const listName = fromState || listItem?.name

  /*
   * 页头的封面：优先是榜单自己的封面；没有（直接打开链接、榜单列表还没回来）
   * 就用榜首那首歌的封面，榜首就是这个榜的脸。
   */
  const itemCover = listItem?.coverArt
    ? (findAdapterFor(listItem.serverId)?.getCoverUrl(listItem.coverArt, 600) ?? listItem.coverArt)
    : undefined
  const { primary: topSongCover } = useCoverUrl(itemCover ? undefined : songs?.[0], { size: 600 })
  const heroCover = itemCover ?? topSongCover
  const title = listName ?? t('sources.topListDetail')

  /*
   * 页头：沉浸式头部（大封面 + 大标题 + 来源 + 曲目数），
   * 播放全部（青柠）/ 随机播放在标题下。返回在外壳的工具栏里，页面不再放返回键。
   */
  const header = (
    <DetailHero
      cover={
        <ImageWithFallback
          src={heroCover}
          alt={title}
          fallbackType="album"
          className="h-full w-full object-cover"
        />
      }
      coverUrl={heroCover}
      title={title}
      subtitle={<SourceBadge serverId={sourceId} withName />}
      meta={
        songs && songs.length > 0 ? <span>{t('song.trackCount', { count: songs.length })}</span> : undefined
      }
      actions={
        songs && songs.length > 0 ? (
          <>
            <Button onClick={() => playAllInOrder(songs, 0)}>
              <Play size={16} weight="fill" />
              {t('player.playAll')}
            </Button>
            <Button variant="secondary" onClick={() => playAllShuffled(songs, 0)}>
              <Shuffle size={17} weight="bold" />
              {t('player.shuffle')}
            </Button>
          </>
        ) : undefined
      }
    />
  )

  return (
    <div className="pt-2 regular:pt-4">
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
          <ErrorState retry={() => { void refetch() }} />
        ) : !songs?.length ? (
          <EmptyState mascot="nuomi-sleep"
            title={t('sources.topListEmptyTitle')}
            description={t('sources.topListEmptyDesc')}
          />
        ) : (
          <SongList songs={songs} showCover showAlbum showIndex sourceBadge />
        )}
        {/* 原始异常只给开发态 */}
        {import.meta.env.DEV && isError && (
          <p className="mt-3 truncate text-[12px] text-ink-3">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
      </div>
    </div>
  )
}
