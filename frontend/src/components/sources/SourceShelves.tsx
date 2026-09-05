/**
 * 首页的多源区块（PLAN 2.3）：
 * - MergedDailyRail：「今天听什么」——把所有来源的推荐合成一条
 * - SourceCollections：每个音源的「我的歌单 / 收藏」入口行
 * - SourceTopListsRail：榜单（只对声明 topLists 的音源出现）
 * - SourceRecommendSheetsRail：推荐歌单合并网格（各源交错，卡片带音源标识）
 *
 * 四块都是「有内容才渲染」：能力未声明、加载失败、空数据都不占版面。
 */

import { useMemo } from 'react'
import { Heart, MusicNotes, Play, Shuffle } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { SourceGroupState } from '@/components/sources/SourceGroupState'
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
  const sourceGroups = useSourceRecommendSongs().filter(g => (g.data?.length ?? 0) > 0)
  // 主库（NAS 等）没有 recommendSongs 这个插件扩展，它的那一份来自本地画像。
  // 不把它算进来的话，只连 NAS 的用户在这条里永远看不到自己的歌。
  const { data: librarySongs } = usePersonalizedRecommendations(20)

  const merged = useMemo(() => {
    const groups = sourceGroups.map(g => ({ songs: g.data! }))
    if (librarySongs?.length) groups.unshift({ songs: librarySongs })
    return interleaveRecommendations(groups, 20)
  }, [sourceGroups, librarySongs])

  if (!merged.length) return null

  return (
    <section aria-labelledby="home-dailymix" data-clay-span="full">
      <div className="section-head">
        <h2 id="home-dailymix">
          {t('sources.dailyMix')}<small>DAILY MIX</small>
        </h2>
        <div className="flex items-center gap-5">
          {sourceGroups.map(g => (
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
    </section>
  )
}

/** 各音源的「我的歌单 / 收藏」入口行（数量为证，入口跳分节页） */
export function SourceCollections() {
  const { t } = useT()
  const navigate = useNavigate()
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
              <SourceGroupState serverId={g.serverId} status={g.status} error={g.error} />
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
  const groups = useSourceTopLists().filter(g => g.status === 'success' && g.data?.groups.length)
  if (!groups.length) return null

  const total = groups.reduce((sum, g) => sum + g.data!.groups.length, 0)
  const truncated = total > groups.length * HOME_TOPLIST_GROUPS

  return (
    <section aria-labelledby="home-toplists">
      <div className="section-head">
        <h2 id="home-toplists">
          {t('sources.topLists')}<small>CHARTS</small>
        </h2>
        {truncated && (
          <button className="more" onClick={() => navigate('/recommendations')}>
            {t('action.viewAll')} →
          </button>
        )}
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
    </section>
  )
}

/** 推荐歌单：各源交错合并成一张网格，卡片角上带音源标识 */
export function SourceRecommendSheetsRail() {
  const { t } = useT()
  const groups = useSourceRecommendSheets().filter(g => (g.data?.length ?? 0) > 0)
  const merged = useMemo(() => {
    // 每源取前 6 张，轮转交错成一张网格；歌单不像歌曲那样跨源去重（同名不同源是两张真实的歌单）
    const queues = groups.map(g => (g.data ?? []).slice(0, 6).map(pl => ({ pl, serverId: g.serverId })))
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
  if (!merged.length) return null

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
  return (
    <button
      className="group text-left min-w-0"
      onClick={() => navigate(`/playlists/${playlist.id}?src=${encodeURIComponent(playlist.serverId)}`)}
    >
      <div className="relative aspect-square rounded-sm overflow-hidden ring-1 ring-hair-soft mb-2 transition-transform duration-300 group-hover:scale-[1.03] pop:border pop:border-hair pop:ring-0">
        <ImageWithFallback
          src={cover}
          alt={playlist.name}
          fallbackType="album"
          className={cn('w-full h-full object-cover')}
        />
        <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-sm bg-paper/85 backdrop-blur-sm px-1.5 py-0.5">
          <SourceBadge serverId={serverId} />
        </span>
      </div>
      <p className="text-[13px] font-serif font-semibold line-clamp-1 group-hover:text-primary transition-colors">
        {playlist.name}
      </p>
      {playlist.songCount !== undefined && (
        <p className="num text-[10.5px] tracking-[0.1em] text-ink-faint mt-0.5">
          {t('song.trackCount', { count: playlist.songCount })}
        </p>
      )}
    </button>
  )
}
