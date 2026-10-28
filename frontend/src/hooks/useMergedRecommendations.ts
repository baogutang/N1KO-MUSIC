/**
 * 「为你推荐」这一条的数据：各插件音源自己的每日推荐 + 本地画像按收听习惯算出来的候选，
 * 按曲目自己的来源分组（交错去重由调用方做）。为你推荐页和横屏正在播放的卡片叠用的是同一份。
 */
import { useMemo } from 'react'
import { recommendationGroupsForMerge, splitGroups } from '@/components/sources/SourceShelves'
import { usePersonalizedRecommendations } from '@/hooks/usePersonalizedRecommendations'
import { useSourceRecommendSongs } from '@/hooks/useSourceQueries'
import { useRecommendationConstraints } from '@/services/recommendationFilters'

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
export function useMergedRecommendations(size: number) {
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
