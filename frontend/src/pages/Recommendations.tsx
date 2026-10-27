/**
 * 为你推荐页 —— 首页「今天听什么」的展开版（DESIGN v2 §3）
 *
 * 首页那条 MergedDailyRail 只摆 20 首，右上角「查看全部」指到这里；
 * 这一页就该是**同一条**，只是更长、可换一批、可按来源筛。
 *
 * 因此它必须和首页走同一套数据：各插件音源自己的每日推荐
 * （useSourceRecommendSongs）+ 本地画像按收听习惯算出来的候选
 * （usePersonalizedRecommendations），轮转交错去重（interleaveRecommendations）。
 * 改之前这里只问主库，于是「查看全部」点进来看到的是另一份榜单，
 * 而首页那几首插件源的歌一首都不在。
 *
 * 「最近添加」「热门歌手」两块删掉了：首页已经有，摆两遍只是把这一页
 * 变成首页的副本，而这一页该回答的只有一个问题——现在放什么。
 */

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowsClockwise, Play, Shuffle } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { SongRowsSkeleton } from '@/components/common/SongRowsSkeleton'
import {
  GroupStateRows,
  recommendationGroupsForMerge,
  splitGroups,
  useRetrySourceGroup,
} from '@/components/sources/SourceShelves'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import {
  interleaveRecommendations,
  useConnectedSources,
  useSourceRecommendSongs,
} from '@/hooks/useSourceQueries'
import { useRecommendationConstraints } from '@/services/recommendationFilters'
import { formatDuration } from '@/utils/formatters'
import { cn } from '@/lib/utils'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { useT } from '@/i18n'

/** 这一页的上限。首页那条是 20，这里是它的展开版 */
const MAX_SONGS = 60

/**
 * 各路推荐合成一张列表，并按**曲目自己的来源**分组。
 *
 * 不按「哪个 hook 产出的」分组：本地画像那一份自带跨源探索候选
 * （usePersonalizedRecommendations 会去别的源取随机/收藏），按产出方分组
 * 会把它们统统错标成主库，来源筛选就跟着错。
 *
 * 合并前过 recommendationGroupsForMerge（与首页 MergedDailyRail 同一条）：
 * 插件源的每日推荐 queryKey 不含屏蔽指纹（10 分钟缓存），不过滤的话
 * 屏蔽了某个歌手，这页在缓存期内照样推他。失败/登录过期的源不再被
 * 静默丢掉——拆出来交给 GroupStateRows 占一行（复核 F1）。
 */
function useMergedRecommendations(size: number) {
  const sourceGroups = useSourceRecommendSongs()
  const { good, loading, failed, auth } = splitGroups(sourceGroups)
  const { data: librarySongs, isFetching, refresh } = usePersonalizedRecommendations(size)
  const constraints = useRecommendationConstraints()

  const grouped = useMemo(
    () => recommendationGroupsForMerge(good, librarySongs, constraints),
    // good/librarySongs 每次渲染都可能是新数组（zipQueryResults 刻意不 memo），
    // 这里的重算只是一次小数组遍历，比吞掉「loading → success」的翻转划算
    [good, librarySongs, constraints]
  )

  return {
    grouped,
    refresh,
    failed,
    loading,
    auth,
    /** 有任意一路还在取：本地画像在算，或者某个插件源还没回来 */
    isFetching: isFetching || sourceGroups.some(g => g.status === 'loading'),
  }
}

export default function RecommendationsPage() {
  const { t } = useT()
  const queryClient = useQueryClient()
  const sources = useConnectedSources()
  const retry = useRetrySourceGroup()
  const { grouped, refresh, isFetching, failed, loading, auth } = useMergedRecommendations(MAX_SONGS)

  /** 来源筛选；null = 全部。选中的源断开后自动回到「全部」 */
  const [pickedSource, setPickedSource] = useState<string | null>(null)
  const source = pickedSource && grouped.some(g => g.serverId === pickedSource) ? pickedSource : null

  const songs = useMemo(
    () => interleaveRecommendations(
      // 先筛再交错，而不是交错完再过滤：后者会让单源视图只剩下轮到它的那几首
      source ? grouped.filter(g => g.serverId === source) : grouped,
      MAX_SONGS
    ),
    [grouped, source]
  )

  function handleNewBatch() {
    // 本地画像有「批次」概念，推进一格就能换一批
    refresh()
    // 插件源的每日推荐没有批次，只能请它重取（网易云的日推每天固定，
    // QQ 的雷达每次都不同——两种都由源自己决定，我们只负责不吃缓存）
    void queryClient.invalidateQueries({ predicate: q => q.queryKey[1] === 'recommend-songs' })
  }

  const totalDuration = songs.reduce((sum, song) => sum + song.duration, 0)

  return (
    <div className="pt-2 regular:pt-4 animate-fade-in">
      <section aria-labelledby="rec-today">
        <h1
          id="rec-today"
          className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]"
        >
          {t('section.dailyPicks')}
        </h1>
        <p className="mt-3 max-w-[52ch] text-[14px] leading-relaxed text-ink-faint">
          {t('recommendations.lede')}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-3">
          {songs.length > 0 && (
            <>
              <button
                className="act-primary inline-flex items-center gap-2 text-[14px]"
                onClick={() => playAllInOrder(songs, 0)}
              >
                <Play size={14} weight="fill" />
                {t('player.playAll')}
              </button>
              <button
                className="act-secondary inline-flex items-center gap-2 text-[14px]"
                onClick={() => playAllShuffled(songs, 0)}
              >
                <Shuffle size={15} />
                {t('player.shuffle')}
              </button>
            </>
          )}
          <button
            className="act-secondary inline-flex items-center gap-2 text-[14px]"
            onClick={handleNewBatch}
            disabled={isFetching}
          >
            <ArrowsClockwise size={15} className={isFetching ? 'animate-spin motion-reduce:animate-none' : undefined} />
            {t('action.newBatch')}
          </button>
          {songs.length > 0 && (
            <span className="num flex flex-wrap gap-x-3 text-[14px] text-ink-faint">
              <span>{t('song.trackCount', { count: songs.length })}</span>
              <span>{formatDuration(totalDuration)}</span>
            </span>
          )}
        </div>

        {/* 来源筛选：只有真的跨了源才有意义，单源时这排 chip 只是噪声 */}
        {grouped.length > 1 && (
          <div
            className="page-tabs mt-6 inline-flex max-w-full gap-1 overflow-x-auto rounded-pill bg-paper-deep p-1 scrollbar-hide"
            role="tablist"
            aria-label={t('recommendations.sourceFilter')}
          >
            <SourceChip
              label={t('recommendations.allSources')}
              selected={source === null}
              onSelect={() => setPickedSource(null)}
            />
            {grouped.map(group => group.serverId && (
              <SourceChip
                key={group.serverId}
                serverId={group.serverId}
                label={sources.find(s => s.serverId === group.serverId)?.name ?? group.serverId}
                selected={source === group.serverId}
                onSelect={() => setPickedSource(group.serverId ?? null)}
              />
            ))}
          </div>
        )}

        <div className="mt-6">
          {songs.length > 0 ? (
            <div className={isFetching ? 'opacity-60 transition-opacity duration-200' : undefined}>
              <SongList songs={songs} showCover showAlbum showIndex sourceBadge />
            </div>
          ) : isFetching ? (
            <SongRowsSkeleton rows={8} />
          ) : (
            <EmptyState
              ruled
              title={t('empty.recommendations.title')}
              description={t('empty.recommendations.description')}
            />
          )}

          {/* 失败/登录过期的源占一行（复核 F1）：静默消失比报错更糟，
              这一页是首页那条的展开版，状态行的约定也与它一致 */}
          <GroupStateRows
            failed={failed}
            loading={loading}
            auth={auth}
            showLoading={!songs.length}
            retry={retry}
            family="recommend-songs"
          />
        </div>
      </section>
    </div>
  )
}

/** 来源分段：徽标 + 名字，当前项是一块托起的纸片（与浏览页的分段同一套） */
function SourceChip({ serverId, label, selected, onSelect }: {
  serverId?: string
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={selected}
      // 点当前项不做任何事——与浏览页的 chip 同一条约定
      disabled={selected}
      onClick={onSelect}
      className={cn(
        'seg-option inline-flex min-h-11 flex-none items-center gap-2 whitespace-nowrap rounded-pill px-4 text-[14px] font-medium transition-colors duration-150',
        selected
          ? 'is-on cursor-default'
          : 'text-ink-soft [@media(hover:hover)]:hover:text-ink'
      )}
    >
      {serverId && <SourceBadge serverId={serverId} />}
      <span>{label}</span>
    </button>
  )
}
