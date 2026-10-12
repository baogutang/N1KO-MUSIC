/**
 * 首页的多源区块（PLAN 2.3）：
 * - MergedDailyRail：「今天听什么」——把所有来源的推荐合成一条
 * - SourceCollections：每个音源的「我的歌单 / 收藏」入口行
 * - SourceTopListsRail：榜单（只对声明 topLists 的音源出现）
 * - SourceRecommendSheetsRail：推荐歌单合并网格（各源交错，卡片带音源标识）
 *
 * 四块都是「有内容才渲染」：能力未声明、加载失败、空数据都不占版面。
 */

import { useCallback, useMemo } from 'react'
import { Heart, MusicNotes, Play, Shuffle } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { CoverCard } from '@/components/common/CoverCard'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { SourceGroupState, groupStateStatus } from '@/components/sources/SourceGroupState'
import type { SourceQueryGroup } from '@/hooks/useSourceQueries'
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
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { useTasteStore } from '@/store/tasteStore'
import { filterRecommendable } from '@/services/recommendationFilters'

/**
 * 单个音源某个区块的重试：失效该源该族 query，TanStack 按挂载状态重取。
 * 失败的源看得见、点得动，而不是从页面上静默消失（SourceGroupState 头注）。
 */
function useRetrySourceGroup() {
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
 */
export function recommendationGroupsForMerge(
  sourceGroups: Array<{ data: import('@/api/types').Song[] }>,
  librarySongs: import('@/api/types').Song[] | undefined
): Array<{ songs: import('@/api/types').Song[] }> {
  const groups = sourceGroups
    .map(g => ({ songs: filterRecommendable(g.data) }))
    .filter(g => g.songs.length > 0)
  if (librarySongs?.length) groups.unshift({ songs: librarySongs })
  return groups
}

/** 一节末尾的状态行（登录过期 + 失败 + 可选的加载骨架） */
function GroupStateRows({
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
  return <div className="border-t border-hair divide-y divide-hair-soft px-2">{rows}</div>
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
  const navigate = useNavigate()
  const retry = useRetrySourceGroup()
  const { good: sourceGroups, loading, failed, auth } = splitGroups(useSourceRecommendSongs())
  // 主库（NAS 等）没有 recommendSongs 这个插件扩展，它的那一份来自本地画像。
  // 不把它算进来的话，只连 NAS 的用户在这条里永远看不到自己的歌。
  const { data: librarySongs } = usePersonalizedRecommendations(20)

  /*
   * 屏蔽指纹参与合并（复审 B1）：插件源每日推荐的 queryKey 没有屏蔽
   * 指纹（10 分钟缓存），主库那份在 1.5 已做渲染端过滤，插件源这份
   * 合并前同样过一遍 filterRecommendable——指纹一变这里就重算。
   */
  const mutedFingerprint = useTasteStore(s =>
    [...s.mutedArtists, ...s.mutedGenres].map(x => x.trim().toLowerCase()).sort().join('|')
  )
  const merged = useMemo(
    () => interleaveRecommendations(recommendationGroupsForMerge(sourceGroups, librarySongs), 20),
    // mutedFingerprint 进依赖：屏蔽名单变化时插件源结果立即重滤（B1）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceGroups, librarySongs, mutedFingerprint]
  )

  // 一个源都没成、也没有要说明的失败/过期时才整节不渲染
  if (!merged.length && !failed.length && !loading.length && !auth.length) return null

  return (
    <section aria-labelledby="home-dailymix" data-clay-span="full">
      <div className="section-head">
        <h2 id="home-dailymix">
          {t('sources.dailyMix')}<small>DAILY MIX</small>
        </h2>
        <div className="flex items-center gap-5">
          {sourceGroups.filter(g => g.data.length > 0).map(g => (
            <SourceBadge key={g.serverId} serverId={g.serverId} withName />
          ))}
          <button
            className="more inline-flex items-center gap-1.5"
            onClick={() => playAllInOrder(merged, 0)}
          >
            <Play size={12} />
            {t('player.playAll')}
          </button>
          <button
            className="more inline-flex items-center gap-1.5"
            onClick={() => playAllShuffled(merged, 0)}
          >
            <Shuffle size={12} />
            {t('player.shuffle')}
          </button>
          {/* 展开版在推荐页：同一条，只是更多、可换一批、可按来源看 */}
          <button className="more" onClick={() => navigate('/recommendations')}>
            {t('action.viewAll')} →
          </button>
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
        <h2 id="home-sources">
          {t('sources.collections')}<small>MY LIBRARIES</small>
        </h2>
      </div>
      <div className="border-t border-hair divide-y divide-hair-soft">
        {groups.map(g => (
          g.status !== 'success' ? (
            <div key={g.serverId} className="px-2">
              <SourceGroupState serverId={g.serverId} status={groupStateStatus(g)} error={g.error} onRetry={() => retry(g.serverId, 'playlists')} />
            </div>
          ) : (
          <div key={g.serverId} className="flex items-center gap-4 px-2 py-3">
            <SourceBadge serverId={g.serverId} withName />
            <span className="num flex-1 text-[11.5px] tracking-[0.12em] text-ink-faint">
              {t('sources.playlistCount', { count: g.data?.length ?? 0 })}
            </span>
            <button
              className="more inline-flex items-center gap-1.5"
              onClick={() => navigate(`/playlists?src=${encodeURIComponent(g.serverId)}`)}
            >
              <MusicNotes size={12} />
              {t('nav.playlists')}
            </button>
            <button
              className="more inline-flex items-center gap-1.5"
              onClick={() => navigate(`/favorites?src=${encodeURIComponent(g.serverId)}`)}
            >
              <Heart size={12} />
              {t('nav.favorites')}
            </button>
          </div>
          )
        ))}
      </div>
    </section>
  )
}

/**
 * 榜单：每个声明的源一组，榜单名做行式 chip，点击进榜单详情。
 *
 * 首页上**只给摘要**：每个源最多两组、每组最多六个。
 * 两个平台加起来有近百个榜，全列出来这张卡会长到七百多像素，
 * 把同一行的其它卡衬成两条小纸片——「首页很割裂」正是这么来的。
 * 仪表盘的卡片是一眼扫完的摘要，要全部就点「全部榜单」。
 */
const HOME_TOPLIST_GROUPS = 2
const HOME_TOPLIST_ITEMS = 6

export function SourceTopListsRail() {
  const { t } = useT()
  const navigate = useNavigate()
  const retry = useRetrySourceGroup()
  const all = useSourceTopLists()
  const groups = all.filter(g => g.status === 'success' && g.data?.groups.length)
  const failed = all.filter(g => g.status === 'error' && g.errorCode !== 'unauthorized')
  const loading = all.filter(g => g.status === 'loading')
  const auth = all.filter(g => g.status === 'error' && g.errorCode === 'unauthorized')
  if (!groups.length && !failed.length && !loading.length && !auth.length) return null

  const total = groups.reduce((sum, g) => sum + g.data!.groups.length, 0)
  const truncated = total > groups.length * HOME_TOPLIST_GROUPS

  return (
    <section aria-labelledby="home-toplists">
      <div className="section-head">
        <h2 id="home-toplists">
          {t('sources.topLists')}<small>CHARTS</small>
        </h2>
        {/* 「查看全部」去榜单列表页（阶段 2.6）：此前跳到每日推荐页，
            一个榜单都没有；被截掉的榜在这里有去处 */}
        <button className="more" onClick={() => navigate('/toplists')}>
          {t('action.viewAll')} →
        </button>
      </div>
      <div className="border-t border-hair divide-y divide-hair-soft">
        {groups.map(g =>
          g.data!.groups.slice(0, HOME_TOPLIST_GROUPS).map(group => (
            <div key={`${g.serverId}:${group.title}`} className="px-2 py-3">
              <p className="flex items-center gap-2.5 mb-2.5">
                <SourceBadge serverId={g.serverId} />
                <span className="font-serif text-[15px] font-semibold">{group.title}</span>
                <span className="num text-[11px] text-ink-faint">
                  {t('sources.sheetCount', { count: group.items.length })}
                </span>
              </p>
              <p className="flex flex-wrap gap-x-5 gap-y-1.5">
                {group.items.slice(0, HOME_TOPLIST_ITEMS).map(item => (
                  <button
                    key={item.id}
                    onClick={() =>
                      navigate(`/toplists/${encodeURIComponent(g.serverId)}/${encodeURIComponent(item.id)}`)
                    }
                    className="border-b border-transparent hover:text-primary hover:border-primary transition-colors duration-200 text-[13px] text-ink-soft"
                  >
                    {item.name}
                  </button>
                ))}
              </p>
            </div>
          ))
        )}
      </div>
      <GroupStateRows failed={failed} loading={loading} auth={auth} showLoading={!groups.length} retry={retry} family="toplists" />
    </section>
  )
}

/** 推荐歌单：各源交错合并成一张网格，卡片角上带音源标识 */
export function SourceRecommendSheetsRail() {
  const { t } = useT()
  const retry = useRetrySourceGroup()
  const { good: groups, loading, failed, auth } = splitGroups(useSourceRecommendSheets())
  const merged = useMemo(() => {
    // 每源取前 6 张，轮转交错成一张网格；歌单不像歌曲那样跨源去重（同名不同源是两张真实的歌单）
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
        <h2 id="home-sheets">
          {t('sources.recommendSheets')}<small>PLAYLISTS FOR YOU</small>
        </h2>
      </div>
      <div className="border-t border-hair pt-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-4">
          {merged.map(({ pl, serverId }) => (
            <MiniSheetCard key={`${serverId}:${pl.id}`} playlist={pl} serverId={serverId} />
          ))}
        </div>
      </div>
      <GroupStateRows failed={failed} loading={loading} auth={auth} showLoading={!merged.length} retry={retry} family="recommend-sheets" />
    </section>
  )
}

/** 迷你歌单卡：小封面（角上音源标识）+ 名称 + 曲目数（首页推荐位专用） */
function MiniSheetCard({ playlist, serverId }: { playlist: Playlist; serverId: string }) {
  const { t } = useT()
  const navigate = useNavigate()
  const cover = playlist.coverArt
    ? (findAdapterFor(playlist.serverId)?.getCoverUrl(playlist.coverArt, 160) ?? playlist.coverArt)
    : undefined
  /* 外壳收敛到 CoverCard（阶段 7.4）；角上的音源标识是这层独有的浮层 */
  return (
    <CoverCard
      aria-label={playlist.name}
      onClick={() => navigate(`/playlists/${playlist.id}?src=${encodeURIComponent(playlist.serverId)}`)}
      tileClassName="rounded-sm"
      tile={
        <ImageWithFallback
          src={cover}
          alt={playlist.name}
          fallbackType="album"
          className="w-full h-full object-cover"
        />
      }
      overlay={
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-paper/85 backdrop-blur-sm px-1.5 py-0.5">
          <SourceBadge serverId={serverId} />
        </span>
      }
      title={playlist.name}
      {...(playlist.songCount !== undefined
        ? { meta: <span className="font-num tracking-[0.1em] text-[10.5px]">{t('song.trackCount', { count: playlist.songCount })}</span> }
        : {})}
    />
  )
}
