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
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { SongRowsSkeleton } from '@/components/common/SongRowsSkeleton'
import { SongList } from '@/components/music/SongList'
import { useServerStore } from '@/store/serverStore'
import { playAllInOrder, shuffleWholeLibrary } from '@/utils/playActions'
import { useT } from '@/i18n'

/**
 * 分段控件的一格：看起来 36px，触点用 ::before 向上下各多出 4px（落在轨道的内边距里），凑足 44px。
 * 当前格底下垫的那块片（surface + 轻投影）由调用方放在里面。
 */
const SEG_OPTION =
  'press-pop relative isolate h-9 flex-none whitespace-nowrap rounded-pill px-4 text-[14px] font-semibold before:absolute before:inset-x-0 before:-inset-y-1'

/** 当前格底下托起的那块片。暗色下 surface 与轨道（ink 6%）几乎同亮（对比 1.03:1），改用 fill-2 才托得起来 */
const SEG_PILL = 'absolute inset-0 -z-10 rounded-pill bg-surface shadow-sm dark:bg-fill-2'

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
  const { data: albumsData, isLoading: albumsLoading, hasNextPage: hasNextAlbums } =
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
      <div className="pt-2 regular:pt-4">
        <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
          {t('nav.library')}
        </h1>
        <div className="mt-8">
          <EmptyState mascot="maodou-wave"
            ruled
            title={t('sources.noBrowseTitle')}
            description={t('sources.noBrowseDesc')}
            action={{ label: t('nav.playlists'), onClick: () => navigate('/playlists') }}
          />
        </div>
      </div>
    )
  }

  const loaded = !songsLoading && songs.length > 0

  return (
    <div className="pt-2 regular:pt-4">
      {/* 页头：大标题 + 体量说明（各自独立的 span，不用中点串）；播放全部是这一屏唯一的青柠键 */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
            {t('nav.library')}
          </h1>
          {/* 加载中不显示 0 计数（阶段 2.1） */}
          {!(songsLoading || albumsLoading) && !songsError && (
            <p className="num mt-3 flex flex-wrap gap-x-3 text-[14px] font-medium text-ink-3">
              <span>{t('library.songsCount', { count: songCountText })}</span>
              <span>{t('library.albumsCount', { count: albumCountText })}</span>
              <span>{t('library.artistsCount', { count: (artists ?? []).length })}</span>
            </p>
          )}
        </div>
        {loaded && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
            <Button onClick={() => playAllInOrder(songs, 0)}>
              <Play size={18} weight="fill" />
              {t('player.playAll')}
            </Button>
            {/*
              全库随机：向服务端要一批随机取样，而不是对已加载的这一页洗牌。
              列表分页加载，首屏只有 100 首且是服务端固定排序的前 100 首，
              对它洗牌听感上就是「随机播放还是按排序在放」。
            */}
            <Button variant="secondary" onClick={handleShuffleAll} disabled={shufflingAll}>
              <Shuffle size={18} className={shufflingAll ? 'animate-spin motion-reduce:animate-none' : undefined} />
              {shufflingAll ? t('library.shuffling') : t('player.shuffleAll')}
            </Button>
          </div>
        )}
      </header>

      {/* 分段控件：只有「歌曲」留在本页（托起的那一格），其余三格是去处 */}
      <div className="mt-6 inline-flex max-w-full overflow-x-auto rounded-pill bg-ink/[0.06] p-1 scrollbar-hide">
        {tabs.map(tab => {
          const here = !tab.to
          return (
            <button
              key={tab.key}
              onClick={() => { if (tab.to) navigate(tab.to) }}
              aria-current={here ? 'page' : undefined}
              className={cn(SEG_OPTION, here ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
            >
              {here && (
                <span aria-hidden="true" className={SEG_PILL} />
              )}
              {tab.label}
            </button>
          )
        })}
      </div>

      <section>
        <div className="section-head">
          <h2>{t('library.allSongs')}</h2>
          {loaded && (
            <span className="num text-[14px] text-ink-3">{t('library.loaded', { count: songs.length })}</span>
          )}
        </div>
        {songsError && songs.length === 0 ? (
          /* 查询失败时若直接渲染空列表，「服务器出错」和「曲库是空的」
             长得一模一样，用户既得不到解释也没有重试入口。

             但只在**一条都没有**时才整页换成错误态：否则「加载更多」
             失败会把已经看到的几百首整个抹掉，代价远大于那条错误信息
             的价值。已有内容时保留列表，让底部的分页按钮自己表达失败。 */
          <ErrorState retry={() => { void refetchSongs() }} />
        ) : songsLoading ? (
          <SongRowsSkeleton rows={10} />
        ) : (
          <>
            <SongList songs={songs} showCover showAlbum showIndex />
            {isFetchingNextPage && <SongRowsSkeleton rows={3} />}
            {hasNextPage && !isFetchingNextPage && (
              <div className="mt-8 flex justify-center">
                <Button variant="secondary" onClick={() => fetchNextPage()}>
                  {t('library.loadMoreSongs')}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
