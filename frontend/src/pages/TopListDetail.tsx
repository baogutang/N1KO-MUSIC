/**
 * 榜单详情（PLAN 2.3）：/toplists/:serverId/:topListId
 *
 * 插件音源的榜单（飙升榜 / 新歌榜这类）没有独立的服务端路由，
 * 由 getTopListDetail 分页取曲；这里先渲染第一页（榜单场景足够）。
 */

import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Shuffle } from '@phosphor-icons/react'
import { SongList } from '@/components/music/SongList'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { useTopListDetail } from '@/hooks/useSourceQueries'
import { playAllInOrder, playAllShuffled } from '@/utils/playActions'
import { EmptyState } from '@/components/common/EmptyState'
import { useT } from '@/i18n'

export default function TopListDetail() {
  const { t } = useT()
  const { serverId = '', topListId = '' } = useParams<{ serverId: string; topListId: string }>()
  const navigate = useNavigate()
  const { data: songs, isLoading, error } = useTopListDetail(decodeURIComponent(serverId), decodeURIComponent(topListId))

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

  if (isLoading) {
    return <div className="pt-10">{backLink}<p className="mt-10 text-sm text-ink-faint">…</p></div>
  }
  if (error || !songs || !songs.length) {
    return (
      <div className="pt-10">
        {backLink}
        <EmptyState title={t('search.noResultInSource')} description={String(error ?? '')} />
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <div className="pt-8 pb-8 border-b border-hair flex items-end gap-5">
        {backLink}
        <div className="flex-1 min-w-0">
          <h1 className="font-serif text-[28px] font-bold flex items-center gap-3">
            {t('sources.topListDetail')}
            <SourceBadge serverId={decodeURIComponent(serverId)} withName />
          </h1>
        </div>
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
      </div>
      <div className="mt-8">
        <SongList songs={songs} showCover showAlbum showIndex sourceBadge />
      </div>
    </div>
  )
}
