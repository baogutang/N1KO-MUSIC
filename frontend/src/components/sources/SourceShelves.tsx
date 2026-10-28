/**
 * 首页的多源区块（PLAN 2.3）：
 * - MergedDailyRail：「今天听什么」——把所有来源的推荐合成一条
 * - SourceCollections：每个音源的「我的歌单 / 收藏」入口行
 * - SourceTopListsRail：榜单（只对声明 topLists 的音源出现），一排榜单封面
 * - SourceRecommendSheetsRail：推荐歌单封面书架（各源交错，卡片带音源标识）
 *
 * 四块都是「有内容才渲染」：能力未声明、加载失败、空数据都不占版面。
 */

import { useCallback, useMemo } from 'react'
import { Heart, MusicNotes } from '@phosphor-icons/react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { CoverCard, CoverGrid, CoverShelf } from '@/components/common/CoverCard'
import { Button } from '@/components/ui/button'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { SourceGroupState, groupStateStatus } from '@/components/sources/SourceGroupState'
import type { SourceQueryGroup, TopListGroups } from '@/hooks/useSourceQueries'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import {
  interleaveRecommendations,
  useSourcePlaylists,
  useSourceRecommendSheets,
  useSourceRecommendSongs,
  useSourceTopLists,
} from '@/hooks/useSourceQueries'
import { findAdapterFor } from '@/api'
import type { Playlist } from '@/api/types'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { useT } from '@/i18n'
import { useTasteStore } from '@/store/tasteStore'
import { filterRecommendable, applyRecommendationConstraints, useRecommendationConstraints, type RecommendationConstraints } from '@/services/recommendationFilters'

/**
 * 单个音源某个区块的重试：失效该源该族 query，TanStack 按挂载状态重取。
 * 失败的源看得见、点得动，而不是从页面上静默消失（SourceGroupState 头注）。
 * 导出共用：推荐页（Recommendations）的展开版也要给失败源一行重试。
 */
export function useRetrySourceGroup() {
  const queryClient = useQueryClient()
  return useCallback(
    (serverId: string, family: string) => {
      void queryClient.invalidateQueries({ queryKey: [serverId, family] })
    },
    [queryClient]
  )
}

/**
 * 把分组拆成「参与合并的成功组」与「要渲染状态行的组」：
 * - 登录过期的源（unauthorized）占一行 auth 态——重试救不回来，出口是去登录；
 * - 失败的源永远占一行（带重试）——静默消失比报错更糟；
 * - 加载中的源只在整节还没有内容时占骨架行，有内容时不打扰（避免布局跳）；
 * - 成功但数据为空不算问题（未登录的插件音源就是这么表现的）。
 */
export function splitGroups<T>(
  groups: SourceQueryGroup<T>[]
): {
  good: Array<SourceQueryGroup<T> & { data: T }>
  loading: SourceQueryGroup<T>[]
  failed: SourceQueryGroup<T>[]
  auth: SourceQueryGroup<T>[]
} {
  const good: Array<SourceQueryGroup<T> & { data: T }> = []
  const loading: SourceQueryGroup<T>[] = []
  const failed: SourceQueryGroup<T>[] = []
  const auth: SourceQueryGroup<T>[] = []
  for (const g of groups) {
    if (g.status === 'error' && g.errorCode === 'unauthorized') auth.push(g)
    else if (g.status === 'error') failed.push(g)
    else if (g.status === 'loading') loading.push(g)
    else if (g.data) good.push(g as SourceQueryGroup<T> & { data: T })
  }
  return { good, loading, failed, auth }
}

/**
 * 每日推荐合并前的分组处理（复审 B1，纯函数可测）：
 * 插件源的每日推荐 queryKey 不含屏蔽指纹（10 分钟缓存），合并前必须
 * 过一遍 filterRecommendable，否则屏蔽后缓存期内照样出现。
 * 分组的 serverId 原样带出（复核 F1：推荐页展开版的来源筛选要用）。
 */
export function recommendationGroupsForMerge(
  sourceGroups: Array<{ serverId?: string; data: import('@/api/types').Song[] }>,
  librarySongs: import('@/api/types').Song[] | undefined,
  constraints?: RecommendationConstraints
): Array<{ serverId?: string; songs: import('@/api/types').Song[] }> {
  const groups = sourceGroups
    .map(g => ({
      serverId: g.serverId,
      songs: constraints
        ? applyRecommendationConstraints(g.data, constraints)
        : filterRecommendable(g.data),
    }))
    .filter(g => g.songs.length > 0)
  if (librarySongs?.length) groups.unshift({ serverId: undefined, songs: librarySongs })
  return groups
}

/** 一节末尾的状态行（登录过期 + 失败 + 可选的加载骨架）；推荐页展开版共用 */
export function GroupStateRows({
  failed,
  loading,
  auth,
  showLoading,
  retry,
  family,
}: {
  failed: SourceQueryGroup<unknown>[]
  loading: SourceQueryGroup<unknown>[]
  auth: SourceQueryGroup<unknown>[]
  showLoading: boolean
  retry: (serverId: string, family: string) => void
  family: string
}) {
  const rows = [
    ...auth.map(g => (
      <SourceGroupState key={`auth-${g.serverId}`} serverId={g.serverId} status="auth" error={g.error} />
    )),
    ...failed.map(g => (
      <SourceGroupState key={`err-${g.serverId}`} serverId={g.serverId} status="error" error={g.error} onRetry={() => retry(g.serverId, family)} />
    )),
    ...(showLoading ? loading.map(g => (
      <SourceGroupState key={`load-${g.serverId}`} serverId={g.serverId} status="loading" />
    )) : []),
  ]
  if (!rows.length) return null
  return <div className="mt-2 px-1">{rows}</div>
}

/**
 * 「今天听什么」——首页唯一的一条推荐。
 *
 * 此前这里是三条并排的东西：本区块（各插件的每日推荐）、首页另一处
 * 「为你推荐」（主库画像算出来的）、以及推荐页的「每日精选」。
 * 三者回答的是同一个问题，摆成三处只会让人问「这仨什么关系」。
 *
 * 现在合成一条：**平台算的**（网易云每日推荐、QQ 雷达）与**本地画像算的**
 * （主库的个性化候选）进同一个轮转交错，按标题+歌手去重。用户不需要知道
 * 某一首是谁算出来的——那是实现细节；他要的只是「现在放什么」。
 * 想看更多就点右上角进推荐页，那里是同一条的展开版。
 */
export function MergedDailyRail() {
  const { t } = useT()
  const retry = useRetrySourceGroup()
  const { good: sourceGroups, loading, failed, auth } = splitGroups(useSourceRecommendSongs())
  // 主库（NAS 等）没有 recommendSongs 这个插件扩展，它的那一份来自本地画像。
  // 不把它算进来的话，只连 NAS 的用户在这条里永远看不到自己的歌。
  const { data: librarySongs } = usePersonalizedRecommendations(20)

  /*
   * 约束对象参与合并（阶段 4.2 取代手写指纹）：插件源每日推荐的 queryKey
   * 没有屏蔽指纹（10 分钟缓存），合并前过一遍 filterRecommendable。
   * useRecommendationConstraints 随屏蔽名单**与账号会员状态**变化，
   * 比原指纹多了 accountVip 维度（会员信息晚到时 VIP 曲也滤得掉）。
   */
  const constraints = useRecommendationConstraints()
  const merged = useMemo(
    () => interleaveRecommendations(recommendationGroupsForMerge(sourceGroups, librarySongs, constraints), 20),
    [sourceGroups, librarySongs, constraints]
  )

  // 一个源都没成、也没有要说明的失败/过期时才整节不渲染
  if (!merged.length && !failed.length && !loading.length && !auth.length) return null

  return (
    <section aria-labelledby="home-dailymix">
      <div className="section-head flex-wrap">
        <h2 id="home-dailymix" className="flex-none">{t('sources.dailyMix')}</h2>
        {/* 窄屏：标题一行、动作一行（三个链接放得下一行）；宽一点就并到标题右边 */}
        <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 regular:ml-auto regular:w-auto regular:justify-end">
          {sourceGroups.filter(g => g.data.length > 0).map(g => (
            <SourceBadge key={g.serverId} serverId={g.serverId} withName />
          ))}
          <button
            className="more -my-3 py-3"
            onClick={() => playAllInOrder(merged, 0)}
          >
            {t('player.playAll')}
          </button>
          <button
            className="more -my-3 py-3"
            onClick={() => playAllShuffled(merged, 0)}
          >
            {t('player.shuffle')}
          </button>
          {/* 展开版在推荐页：同一条，只是更多、可换一批、可按来源看 */}
          <Link className="more -my-3 py-3" to="/recommendations">
            {t('action.viewAll')}
          </Link>
        </div>
      </div>
      <SongList songs={merged} showCover showAlbum showIndex sourceBadge />
      <GroupStateRows failed={failed} loading={loading} auth={auth} showLoading={!merged.length} retry={retry} family="recommend-songs" />
    </section>
  )
}

/** 各音源的「我的歌单 / 收藏」入口行（数量为证，入口跳分节页） */
export function SourceCollections() {
  const { t } = useT()
  const navigate = useNavigate()
  const retry = useRetrySourceGroup()
  /* 不再 filter 掉非成功的分组：音源失败时要看得见一行说明，
     而不是让它从「我的音乐库」里凭空消失（见 SourceGroupState 的文件头）*/
  const groups = useSourcePlaylists()
  if (!groups.length) return null

  return (
    <section aria-labelledby="home-sources">
      <div className="section-head">
        <h2 id="home-sources">{t('sources.collections')}</h2>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-4">
        {groups.map(g => (
          g.status !== 'success' ? (
            <div key={g.serverId} className="sheet px-4 py-1">
              <SourceGroupState serverId={g.serverId} status={groupStateStatus(g)} error={g.error} onRetry={() => retry(g.serverId, 'playlists')} />
            </div>
          ) : (
            <div key={g.serverId} className="sheet flex flex-col gap-4 p-4 regular:p-5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <SourceBadge serverId={g.serverId} withName />
                <span className="num text-[13px] text-ink-3">
                  {t('sources.playlistCount', { count: g.data?.length ?? 0 })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/playlists?src=${encodeURIComponent(g.serverId)}`)}
                >
                  <MusicNotes size={16} />
                  {t('nav.playlists')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => navigate(`/favorites?src=${encodeURIComponent(g.serverId)}`)}
                >
                  <Heart size={16} />
                  {t('nav.favorites')}
                </Button>
              </div>
            </div>
          )
        ))}
      </div>
    </section>
  )
}

/**
 * 榜单：每个声明的源，榜单做成封面卡，点击进榜单详情。
 *
 * 首页上**只给摘要**：每个源最多两组、每组最多六个，摊成一排封面书架，
 * 组名写在图注里。两个平台加起来有近百个榜，全列出来会把首页撑得很长。
 * 要全部就点「查看全部」去榜单列表页。
 */
const HOME_TOPLIST_GROUPS = 2
const HOME_TOPLIST_ITEMS = 6

export function SourceTopListsRail() {
  const { t } = useT()
  const retry = useRetrySourceGroup()
  const all = useSourceTopLists()
  const groups = all.filter(g => g.status === 'success' && g.data?.groups.length)
  const failed = all.filter(g => g.status === 'error' && g.errorCode !== 'unauthorized')
  const loading = all.filter(g => g.status === 'loading')
  const auth = all.filter(g => g.status === 'error' && g.errorCode === 'unauthorized')
  if (!groups.length && !failed.length && !loading.length && !auth.length) return null

  return (
    <section aria-labelledby="home-toplists">
      <div className="section-head">
        <h2 id="home-toplists">{t('sources.topLists')}</h2>
        {/* 「查看全部」去榜单列表页（阶段 2.6）：此前跳到每日推荐页，
            一个榜单都没有；被截掉的榜在这里有去处 */}
        <Link className="more -my-3 py-3" to="/toplists">
          {t('action.viewAll')}
        </Link>
      </div>
      {groups.length > 0 && (
        <CoverShelf>
          {groups.flatMap(g =>
            g.data!.groups.slice(0, HOME_TOPLIST_GROUPS).flatMap(group =>
              group.items.slice(0, HOME_TOPLIST_ITEMS).map(item => (
                <ChartCard
                  key={`${g.serverId}:${group.title}:${item.id}`}
                  serverId={g.serverId}
                  item={item}
                  meta={group.title}
                  showSource
                />
              ))
            )
          )}
        </CoverShelf>
      )}
      <GroupStateRows failed={failed} loading={loading} auth={auth} showLoading={!groups.length} retry={retry} family="toplists" />
    </section>
  )
}

/**
 * 一组榜单：组名 + 数量，下面是这一组的榜单封面，点击进榜单详情。
 * 榜单列表页用（全部，来源已在分节标题里）；showSource 时每张封面角上带来源标识。
 */
export function TopListGroupCard({
  serverId,
  group,
  limit,
  showSource = false,
}: {
  serverId: string
  group: TopListGroups['groups'][number]
  /** 只列前几个；缺省全列 */
  limit?: number
  showSource?: boolean
}) {
  const { t } = useT()
  const items = limit ? group.items.slice(0, limit) : group.items
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-display text-[19px] font-semibold tracking-[-0.015em] text-ink">{group.title}</h3>
        <span className="num text-[13px] text-ink-3">
          {t('sources.sheetCount', { count: group.items.length })}
        </span>
      </div>
      <CoverGrid>
        {items.map(item => (
          <ChartCard key={item.id} serverId={serverId} item={item} showSource={showSource} />
        ))}
      </CoverGrid>
    </div>
  )
}

/** 歌单 / 榜单封面：插件给的 artwork 本身就是可用地址；有适配器的源按尺寸取 */
function sheetCoverUrl(playlist: Playlist, size: number): string | undefined {
  if (!playlist.coverArt) return undefined
  return findAdapterFor(playlist.serverId)?.getCoverUrl(playlist.coverArt, size) ?? playlist.coverArt
}

/** 封面角上的来源标识：一枚浮在封面上的小胶囊 */
function SourceCorner({ serverId }: { serverId: string }) {
  return (
    <span className="absolute left-2 top-2 flex items-center gap-1 rounded-pill bg-surface px-2 py-1 shadow-sm">
      <SourceBadge serverId={serverId} />
    </span>
  )
}

/** 榜单卡：封面 + 榜名（+ 图注）；点开进榜单详情 */
function ChartCard({
  serverId,
  item,
  meta,
  showSource = false,
}: {
  serverId: string
  item: Playlist
  meta?: string
  showSource?: boolean
}) {
  const navigate = useNavigate()
  return (
    <CoverCard
      aria-label={item.name}
      onClick={() =>
        navigate(`/toplists/${encodeURIComponent(serverId)}/${encodeURIComponent(item.id)}`)
      }
      tile={
        <ImageWithFallback
          src={sheetCoverUrl(item, 300)}
          alt={item.name}
          fallbackType="album"
          className="h-full w-full object-cover"
        />
      }
      overlay={showSource ? <SourceCorner serverId={serverId} /> : undefined}
      title={item.name}
      meta={meta}
    />
  )
}

/** 推荐歌单：各源交错合并成一排封面书架，卡片角上带音源标识 */
export function SourceRecommendSheetsRail() {
  const { t } = useT()
  const retry = useRetrySourceGroup()
  const { good: groups, loading, failed, auth } = splitGroups(useSourceRecommendSheets())
  const merged = useMemo(() => {
    // 每源取前 6 张，轮转交错成一排；歌单不像歌曲那样跨源去重（同名不同源是两张真实的歌单）
    const queues = groups.map(g => g.data.slice(0, 6).map(pl => ({ pl, serverId: g.serverId })))
    const out: Array<{ pl: Playlist; serverId: string }> = []
    let progressed = true
    while (progressed) {
      progressed = false
      for (const q of queues) {
        const head = q.shift()
        if (head) {
          out.push(head)
          progressed = true
        }
      }
    }
    return out.slice(0, 12)
  }, [groups])
  if (!merged.length && !failed.length && !loading.length && !auth.length) return null

  return (
    <section aria-labelledby="home-sheets">
      <div className="section-head">
        <h2 id="home-sheets">{t('sources.recommendSheets')}</h2>
      </div>
      {merged.length > 0 && (
        <CoverShelf>
          {merged.map(({ pl, serverId }) => (
            <MiniSheetCard key={`${serverId}:${pl.id}`} playlist={pl} serverId={serverId} />
          ))}
        </CoverShelf>
      )}
      <GroupStateRows failed={failed} loading={loading} auth={auth} showLoading={!merged.length} retry={retry} family="recommend-sheets" />
    </section>
  )
}

/** 歌单卡：封面（角上音源标识）+ 名称 + 曲目数（首页推荐位专用） */
function MiniSheetCard({ playlist, serverId }: { playlist: Playlist; serverId: string }) {
  const { t } = useT()
  const navigate = useNavigate()
  /* 外壳收敛到 CoverCard（阶段 7.4）；角上的音源标识是这层独有的浮层 */
  return (
    <CoverCard
      aria-label={playlist.name}
      onClick={() => navigate(`/playlists/${playlist.id}?src=${encodeURIComponent(playlist.serverId)}`)}
      tile={
        <ImageWithFallback
          src={sheetCoverUrl(playlist, 300)}
          alt={playlist.name}
          fallbackType="album"
          className="h-full w-full object-cover"
        />
      }
      overlay={<SourceCorner serverId={serverId} />}
      title={playlist.name}
      {...(playlist.songCount !== undefined
        ? { meta: <span className="num">{t('song.trackCount', { count: playlist.songCount })}</span> }
        : {})}
    />
  )
}
