/**
 * 曲库页 —— 主库的「全部歌曲」。
 *
 * 专辑与歌手不在这里展开：它们各有一张带源切换的浏览页（/albums、/artists），
 * 而这里的 tab 只能看主库，等于同一件事有两套入口、其中一套还少一半能力。
 * 四个 tab 保留成导航（歌单那格早就是这么做的），点了就去那张页。
 */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Play, Shuffle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { useAlbumsInfinite, useArtists, useSongsInfinite } from '@/hooks/useServerQueries'
import { useSourceCapabilities } from '@/hooks/useSourceQueries'
import { EmptyState } from '@/components/common/EmptyState'
import { SongList } from '@/components/music/SongList'
import { useServerStore } from '@/store/serverStore'
import { playAllInOrder, shuffleWholeLibrary } from '@/utils/playActions'
import { useT } from '@/i18n'

/** 骨架行（hair-soft 底色闪烁，DESIGN §4.5，不用 spinner） */
function SkeletonRows({ count, cover }: { count: number; cover: boolean }) {
  return (
    <div className="border-t border-hair divide-y divide-hair-soft">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-3 py-2.5">
          <div className="h-3 w-8 rounded-sm bg-skeleton animate-pulse" />
          {cover && <div className="h-10 w-10 rounded-sm bg-skeleton animate-pulse" />}
          <div className="flex-1 space-y-2">
            <div className="h-3 w-1/3 rounded-sm bg-skeleton animate-pulse" />
            <div className="h-2.5 w-1/5 rounded-sm bg-skeleton animate-pulse" />
          </div>
          <div className="h-3 w-10 rounded-sm bg-skeleton animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export default function Library() {
  const { t } = useT()
  const navigate = useNavigate()
  /**
   * 旧版把 tab 存在 `?tab=`，用户的历史记录与书签里还留着
   * `/library?tab=albums`。这两格现在有了自己的页面，老链接直接送过去，
   * 而不是悄悄落回「歌曲」让人以为书签坏了。replace：这是一次纠正，
   * 不该在返回栈里留一格。
   */
  const [params] = useSearchParams()
  const tabParam = params.get('tab')
  useEffect(() => {
    if (tabParam === 'albums') navigate('/albums', { replace: true })
    else if (tabParam === 'artists') navigate('/artists', { replace: true })
  }, [tabParam, navigate])

  /**
   * 主库不提供曲库浏览（PROTOCOL §6 libraryBrowse，流媒体插件一般不声明）时，
   * 这一页没有任何内容可摆：歌曲列表要全库枚举、计数也算不出来。
   * 与其把空 tab 和空列表摆在那儿让人以为坏了，不如只留一句说明加指路。
   *
   * 判据取能力而不是「是不是插件」：这一页要的是「能不能枚举全库」，
   * 那是 libraryBrowse 回答的问题；哪天有插件能枚举，这里不用改。
   * 快照取不到（还没连上）时按可浏览算，免得启动瞬间闪一下引导态。
   *
   * 这三行必须排在查询之前：下面三条查询都靠它决定发不发。
   */
  const activeServerId = useServerStore(s => s.activeServerId)
  const sourceCaps = useSourceCapabilities()
  const canBrowse = sourceCaps[activeServerId ?? '']?.libraryBrowse !== false

  // 专辑/歌手只取计数：页头那行是曲库的体量说明，展开各自在 /albums、/artists。
  // 不可浏览时连请求都不发——渲染的是引导页，这三条查询的结果没有任何去处，
  // 却要让插件源白跑三次注定失败的全库枚举。
  const { data: albumsData, hasNextPage: hasNextAlbums } =
    useAlbumsInfinite(50, 'alphabeticalByName', undefined, { enabled: canBrowse })
  const { data: artists } = useArtists(undefined, { enabled: canBrowse })
  const {
    data: songsData,
    isLoading: songsLoading,
    isError: songsError,
    refetch: refetchSongs,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSongsInfinite(100, { enabled: canBrowse })

  const songs = songsData?.pages.flatMap(p => p.items) ?? []

  const [shufflingAll, setShufflingAll] = useState(false)
  async function handleShuffleAll() {
    if (shufflingAll) return
    setShufflingAll(true)
    try {
      await shuffleWholeLibrary(songs)
    } finally {
      setShufflingAll(false)
    }
  }

  // 计数展示：服务器返回精确总数时直接显示总数；否则显示已加载数量，还有更多页时以 + 提示
  const songsTotal = songsData?.pages[0]?.total
  const songCountText = songsTotal != null ? String(songsTotal) : `${songs.length}${hasNextPage ? '+' : ''}`
  const albumsTotal = albumsData?.pages[0]?.total
  const loadedAlbums = albumsData?.pages.reduce((n, p) => n + p.items.length, 0) ?? 0
  const albumCountText = albumsTotal != null
    ? String(albumsTotal)
    : `${loadedAlbums}${hasNextAlbums ? '+' : ''}`

  /** 四格里只有「歌曲」留在本页，其余三格是去处 */
  const tabs: { key: string; label: string; to?: string }[] = [
    { key: 'songs', label: t('library.songs') },
    { key: 'albums', label: t('library.albums'), to: '/albums' },
    { key: 'artists', label: t('nav.artists'), to: '/artists' },
    { key: 'playlists', label: t('nav.playlists'), to: '/playlists' },
  ]

  if (!canBrowse) {
    return (
      <div className="pt-9 animate-fade-in">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">{t('nav.library')}</h1>
        <div className="mt-8">
          <EmptyState
            ruled
            title={t('sources.noBrowseTitle')}
            description={t('sources.noBrowseDesc')}
            action={{ label: t('nav.playlists'), onClick: () => navigate('/playlists') }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="pt-9 animate-fade-in">
      {/* 页头：衬线标题 + mono 计数 */}
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl font-bold tracking-tight text-ink">{t('nav.library')}</h1>
          <p className="num text-sm text-ink-soft mt-1.5">
            {t('library.counts', {
              songs: songCountText,
              albums: albumCountText,
              artists: (artists ?? []).length,
            })}
          </p>
        </div>
      </div>

      {/* 文字 tab：sans 小标签 wide-tracking，当前项 accent + 2px 短划线（DESIGN §3 导航范式） */}
      <div className="page-tabs mt-7 flex items-center gap-8 border-b border-hair">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { if (tab.to) navigate(tab.to) }}
            className={cn(
              'relative pb-3 text-[13px] tracking-[0.2em] transition-colors duration-200',
              tab.to ? 'text-ink-soft hover:text-primary' : 'text-primary font-semibold'
            )}
          >
            {tab.label}
            {!tab.to && (
              <span className="absolute -bottom-px left-1/2 h-[2px] w-6 -translate-x-1/2 bg-primary" />
            )}
          </button>
        ))}
      </div>

      <div className="pt-8">
        {!songsLoading && songs.length > 0 && (
          <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="flex items-baseline gap-3">
              <h2 className="font-serif text-xl font-bold text-ink">{t('library.allSongs')}</h2>
              <span className="num text-xs text-ink-faint">{t('library.loaded', { count: songs.length })}</span>
            </div>
            <div className="flex items-center gap-6">
              {/* 主操作：纯文字 ▶ + 发丝下划线，hover 变 accent（DESIGN §4.1） */}
              <button
                onClick={() => playAllInOrder(songs, 0)}
                className="act-primary inline-flex items-center gap-2 border-b border-ink pb-1 text-sm font-semibold tracking-[0.1em] text-ink transition-colors duration-200 hover:border-primary hover:text-primary active:scale-[0.97]"
              >
                <Play size={13} weight="fill" />
                {t('player.playAll')}
              </button>
              {/* 次操作：细线小钮，hover 边框变 ink（DESIGN §4.1） */}
              {/*
                全库随机：向服务端要一批随机取样，而不是对已加载的这一页洗牌。
                列表分页加载，首屏只有 100 首且是服务端固定排序的前 100 首，
                对它洗牌听感上就是「随机播放还是按排序在放」。
              */}
              <button
                onClick={handleShuffleAll}
                disabled={shufflingAll}
                className="act-secondary inline-flex items-center gap-2 rounded border border-hair px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97] disabled:opacity-50"
              >
                <Shuffle size={14} className={shufflingAll ? 'animate-spin' : undefined} />
                {shufflingAll ? t('library.shuffling') : t('player.shuffleAll')}
              </button>
            </div>
          </div>
        )}
        {songsError && songs.length === 0 ? (
          /* 查询失败时若直接渲染空列表，「服务器出错」和「曲库是空的」
             长得一模一样，用户既得不到解释也没有重试入口。

             但只在**一条都没有**时才整页换成错误态：否则「加载更多」
             失败会把已经看到的几百首整个抹掉，代价远大于那条错误信息
             的价值。已有内容时保留列表，让底部的分页按钮自己表达失败。 */
          <EmptyState
            ruled
            title={t('error.load.title')}
            description={t('error.load.description')}
            action={{ label: t('action.retry'), onClick: () => { void refetchSongs() } }}
          />
        ) : songsLoading ? (
          <SkeletonRows count={10} cover />
        ) : (
          <>
            <SongList songs={songs} showCover showAlbum showIndex />
            {isFetchingNextPage && <SkeletonRows count={3} cover />}
            {hasNextPage && !isFetchingNextPage && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={() => fetchNextPage()}
                  className="act-secondary inline-flex items-center gap-2 rounded border border-hair px-5 py-2 text-[13px] text-ink-soft transition-colors duration-200 hover:border-ink hover:text-ink active:scale-[0.97]"
                >
                  {t('library.loadMoreSongs')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
