/**
 * 专辑列表页 —— 封面墙（封面是唯一的大面积色块）
 * 大标题 + 总数；多源时一枚分段控件切换音源；无限分页「加载更多」，加载中显示封面形骨架块
 *
 * 多源（PLAN 2.4）：只列声明 libraryBrowse 的音源；多个可浏览源时页头
 * 出现源切换（?src=）——浏览的是「选中的那一个源」而不是跨源拼接，
 * 专辑墙跨源混排需要先解决排序与去重语义，留给聚合视图迭代。
 */

import { useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { cn } from '@/lib/utils'
import { SPRING_SNAPPY } from '@/lib/motion'
import { AlbumCard } from '@/components/music/AlbumCard'
import { CoverGrid } from '@/components/common/CoverCard'
import { useAlbumsInfinite } from '@/hooks/useServerQueries'
import { useBrowseSource } from '@/hooks/useSourceQueries'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { useT } from '@/i18n'
import { sourceParam } from '@/lib/sourceParam'

/**
 * 分段控件的一格：看起来 36px，触点用 ::before 向上下各多出 4px（落在轨道的内边距里），凑足 44px。
 */
const SEG_OPTION =
  'press-pop relative isolate inline-flex h-9 flex-none items-center gap-2 whitespace-nowrap rounded-pill px-4 text-[14px] font-semibold before:absolute before:inset-x-0 before:-inset-y-1'

/** 当前格底下托起的那块片。暗色下 surface 与轨道（ink 6%）几乎同亮（对比 1.03:1），改用 fill-2 才托得起来 */
const SEG_PILL = 'absolute inset-0 -z-10 rounded-pill seg-pill'

/** 封面形骨架：方块 + 两行图注，位置和真实卡片一致，换成真内容时版面不跳 */
function AlbumSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} aria-hidden="true">
          <div className="skeleton cover-frame aspect-square" />
          <div className="skeleton mt-2.5 h-3.5 w-3/4 rounded-pill" />
          <div className="skeleton mt-2 h-3 w-1/2 rounded-pill" />
        </div>
      ))}
    </>
  )
}

export default function AlbumsPage() {
  const { t } = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const srcParam = sourceParam(searchParams)
  const { available, current } = useBrowseSource(srcParam)
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAlbumsInfinite(50, 'newest', current?.serverId)

  if (!current) {
    return (
      <div className="pt-2 regular:pt-4">
        <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
          {t('section.albums')}
        </h1>
        <div className="mt-8">
          <EmptyState mascot="maodou-wave" ruled title={t('sources.noBrowseTitle')} description={t('sources.noBrowseDesc')} />
        </div>
      </div>
    )
  }

  const albums = data?.pages.flatMap(p => p.items) ?? []

  // 计数：服务器返回精确总数时显示总数；否则显示已加载数量，有更多页时以 + 提示
  const total = data?.pages[0]?.total
  const countText = total != null ? String(total) : `${albums.length}${hasNextPage ? '+' : ''}`

  return (
    <div className="pt-2 regular:pt-4">
      <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
        {t('section.albums')}
      </h1>
      {!isLoading && (
        <p className="num mt-3 text-[14px] font-medium text-ink-3">
          {t('album.total', { count: countText })}
        </p>
      )}
      {available.length > 1 && (
        <div className="mt-6 inline-flex max-w-full overflow-x-auto rounded-pill bg-ink/[0.06] p-1 scrollbar-hide">
          {available.map(s => {
            const here = s.serverId === current.serverId
            return (
              <button
                key={s.serverId}
                /* 点当前项什么都不做。原来这里清空 ?src=，而 useBrowseSource 在没有
                   ?src= 时会回落「主库或第一个可浏览源」——于是点亮着的那个选项，
                   浏览的库会跳到另一个源去。 */
                disabled={here}
                onClick={() => setSearchParams({ src: s.serverId }, { replace: true })}
                className={cn(SEG_OPTION, here ? 'cursor-default text-ink' : 'text-ink-3 hover:text-ink-2')}
              >
                {here && (
                  <motion.span
                    layoutId="albums-source"
                    transition={SPRING_SNAPPY}
                    aria-hidden="true"
                    className={SEG_PILL}
                  />
                )}
                <SourceBadge serverId={s.serverId} />
                <span>{s.name}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="mt-8">
        {isError && albums.length === 0 ? (
          <ErrorState retry={() => { void refetch() }} />
        ) : isLoading ? (
          <CoverGrid>
            <AlbumSkeletons count={15} />
          </CoverGrid>
        ) : (
          <>
            <CoverGrid className="[&>*]:min-w-0">
              {albums.map(album => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </CoverGrid>
            {isFetchingNextPage && (
              <CoverGrid className="mt-6">
                <AlbumSkeletons count={5} />
              </CoverGrid>
            )}
            {hasNextPage && !isFetchingNextPage && (
              <div className="mt-10 flex justify-center">
                <Button variant="secondary" onClick={() => fetchNextPage()}>
                  {t('action.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
