/**
 * 首页的多源区块（PLAN 2.3）：
 * - SourceCollections：每个音源的「我的歌单 / 收藏」入口行
 * - SourceTopListsRail：榜单（只对声明 topLists 的音源出现）
 * - SourceRecommendSheetsRail：推荐歌单（只对声明 recommendSheets 的音源出现）
 *
 * 三块都是「有内容才渲染」：能力未声明、加载失败、空数据都不占版面。
 */

import { Heart, MusicNotes } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import { ImageWithFallback } from '@/components/common/ImageWithFallback'
import { SourceBadge } from '@/components/sources/SourceBadge'
import {
  useSourcePlaylists,
  useSourceRecommendSheets,
  useSourceTopLists,
} from '@/hooks/useSourceQueries'
import { findAdapterFor } from '@/api'
import type { Playlist } from '@/api/types'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'

/** 各音源的「我的歌单 / 收藏」入口行（数量为证，入口跳分节页） */
export function SourceCollections() {
  const { t } = useT()
  const navigate = useNavigate()
  const groups = useSourcePlaylists().filter(g => g.status === 'success')
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
        ))}
      </div>
    </section>
  )
}

/** 榜单：每个声明的源一组，榜单名做行式 chip，点击进榜单详情 */
export function SourceTopListsRail() {
  const { t } = useT()
  const navigate = useNavigate()
  const groups = useSourceTopLists().filter(g => g.status === 'success' && g.data?.groups.length)
  if (!groups.length) return null

  return (
    <section aria-labelledby="home-toplists">
      <div className="section-head">
        <h2 id="home-toplists">
          {t('sources.topLists')}<small>CHARTS</small>
        </h2>
      </div>
      <div className="border-t border-hair divide-y divide-hair-soft">
        {groups.map(g =>
          g.data!.groups.map(group => (
            <div key={`${g.serverId}:${group.title}`} className="px-2 py-3">
              <p className="flex items-center gap-2.5 mb-2.5">
                <SourceBadge serverId={g.serverId} />
                <span className="font-serif text-[15px] font-semibold">{group.title}</span>
                <span className="num text-[11px] text-ink-faint">
                  {t('sources.sheetCount', { count: group.items.length })}
                </span>
              </p>
              <p className="flex flex-wrap gap-x-5 gap-y-1.5">
                {group.items.slice(0, 8).map(item => (
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

/** 推荐歌单：小封面横排（只显示声明能力的源） */
export function SourceRecommendSheetsRail() {
  const { t } = useT()
  const groups = useSourceRecommendSheets().filter(g => (g.data?.length ?? 0) > 0)
  if (!groups.length) return null

  return (
    <section aria-labelledby="home-sheets">
      <div className="section-head">
        <h2 id="home-sheets">
          {t('sources.recommendSheets')}<small>PLAYLISTS FOR YOU</small>
        </h2>
      </div>
      <div className="border-t border-hair divide-y divide-hair-soft">
        {groups.map(g => (
          <div key={g.serverId} className="py-4">
            <p className="flex items-center gap-2.5 mb-3.5 px-2">
              <SourceBadge serverId={g.serverId} withName />
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-4">
              {g.data!.slice(0, 6).map(pl => (
                <MiniSheetCard key={pl.id} playlist={pl} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** 迷你歌单卡：小封面 + 名称 + 曲目数（首页推荐位专用，比歌单页的卡紧凑） */
function MiniSheetCard({ playlist }: { playlist: Playlist }) {
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
      <div className="aspect-square rounded-sm overflow-hidden ring-1 ring-hair-soft mb-2 transition-transform duration-300 group-hover:scale-[1.03] pop:border pop:border-hair pop:ring-0">
        <ImageWithFallback
          src={cover}
          alt={playlist.name}
          fallbackType="album"
          className={cn('w-full h-full object-cover')}
        />
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
