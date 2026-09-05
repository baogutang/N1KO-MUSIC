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
import { ArrowsClockwise } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { EmptyState } from '@/components/common/EmptyState'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import {
  interleaveRecommendations,
  useConnectedSources,
  useSourceRecommendSongs,
} from '@/hooks/useSourceQueries'
import { formatDuration } from '@/utils/formatters'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import type { Song } from '@/api/types'
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
 * 分组顺序即轮转顺序：本地画像先进，所以它出第一首，其余源依次跟上，
 * 谁也不刷屏（interleaveRecommendations 的语义）。
 */
function useMergedRecommendations(size: number) {
  const sourceGroups = useSourceRecommendSongs()
  const { data: librarySongs, isFetching, refresh } = usePersonalizedRecommendations(size)

  const grouped = useMemo(() => {
    const byServer = new Map<string, Song[]>()
    const add = (songs: Song[] | undefined) => {
      for (const song of songs ?? []) {
        const list = byServer.get(song.serverId)
        if (list) list.push(song)
        else byServer.set(song.serverId, [song])
      }
    }
    add(librarySongs)
    for (const group of sourceGroups) add(group.data)
    return [...byServer].map(([serverId, songs]) => ({ serverId, songs }))
    // sourceGroups 每次渲染都是新数组（zipQueryResults 刻意不 memo，见其注释），
    // 这里的重算只是一次小数组遍历，比吞掉「loading → success」的翻转划算
  }, [librarySongs, sourceGroups])

  return {
    grouped,
    refresh,
    /** 有任意一路还在取：本地画像在算，或者某个插件源还没回来 */
    isFetching: isFetching || sourceGroups.some(g => g.status === 'loading'),
  }
}

export default function RecommendationsPage() {
  const { t } = useT()
  const queryClient = useQueryClient()
  const sources = useConnectedSources()
  const { grouped, refresh, isFetching } = useMergedRecommendations(MAX_SONGS)

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
    <div className="animate-fade-in">
      <section aria-labelledby="rec-today">
        <div className="section-head">
          <h2 id="rec-today">
            {t('section.dailyPicks')}<small>DAILY PICKS</small>
          </h2>
          <div className="flex items-baseline gap-7">
            {songs.length > 0 && (
              <>
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('song.trackCountDuration', {
                    count: songs.length,
                    duration: formatDuration(totalDuration),
                  })}
                </span>
                <button className="more" onClick={() => playAllInOrder(songs, 0)}>
                  {t('player.playAll')}
                </button>
                <button className="more" onClick={() => playAllShuffled(songs, 0)}>
                  {t('player.shuffle')}
                </button>
              </>
            )}
            <button
              className="more inline-flex items-center gap-1.5"
              onClick={handleNewBatch}
              disabled={isFetching}
            >
              <ArrowsClockwise size={12} className={isFetching ? 'animate-spin' : undefined} />
              {t('action.newBatch')}
            </button>
          </div>
        </div>
        <p className="-mt-2 mb-6 max-w-[52ch] text-[13px] text-ink-faint">
          {t('recommendations.lede')}
        </p>

        {/* 来源筛选：只有真的跨了源才有意义，单源时这排 chip 只是噪声 */}
        {grouped.length > 1 && (
          <div
            className="mb-6 flex flex-wrap items-center gap-4"
            role="tablist"
            aria-label={t('recommendations.sourceFilter')}
          >
            <SourceChip
              label={t('recommendations.allSources')}
              selected={source === null}
              onSelect={() => setPickedSource(null)}
            />
            {grouped.map(group => (
              <SourceChip
                key={group.serverId}
                serverId={group.serverId}
                label={sources.find(s => s.serverId === group.serverId)?.name ?? group.serverId}
                selected={source === group.serverId}
                onSelect={() => setPickedSource(group.serverId)}
              />
            ))}
          </div>
        )}

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
      </section>
    </div>
  )
}

/** 来源 chip：与专辑/歌手浏览页同一套（徽标 + 名字 + 下缘 accent） */
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
      className={
        'inline-flex items-center gap-1.5 pb-1 border-b transition-colors ' +
        (selected ? 'border-primary text-primary' : 'border-transparent text-ink-faint hover:text-foreground')
      }
    >
      {serverId && <SourceBadge serverId={serverId} />}
      <span className="text-[12px]">{label}</span>
    </button>
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
