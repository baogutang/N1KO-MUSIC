/**
 * 榜单列表页（阶段 2.6）：/toplists
 *
 * 首页的榜单只摆一排摘要（每源两组、每组六个），截掉的榜从此有了去处。
 * 这里按音源分节、每节按组摊开，每个榜是一张封面卡。
 * 数据复用 useSourceTopLists（与首页同一条 query，缓存共享）。
 */

import { EmptyState } from '@/components/common/EmptyState'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { SourceGroupState, groupStateStatus } from '@/components/sources/SourceGroupState'
import { TopListGroupCard } from '@/components/sources/SourceShelves'
import { useSourceTopLists } from '@/hooks/useSourceQueries'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@/i18n'

export default function TopListsPage() {
  const { t } = useT()
  const queryClient = useQueryClient()
  const groups = useSourceTopLists()

  const retry = (serverId: string) => {
    void queryClient.invalidateQueries({ queryKey: [serverId, 'toplists'] })
  }

  return (
    <div className="pt-2 regular:pt-4">
      <h1 className="font-display text-[34px] font-bold leading-[1.05] tracking-[-0.03em] text-ink regular:text-[44px]">
        {t('sources.topLists')}
      </h1>

      {groups.length === 0 && (
        <EmptyState mascot="nuomi-sleep" className="mt-8" title={t('sources.topListsNone')} />
      )}

      {groups.map(g => (
        <section key={g.serverId} aria-labelledby={`toplists-${g.serverId}`}>
          <div className="section-head">
            <h2 id={`toplists-${g.serverId}`} className="flex min-w-0 items-center gap-2.5">
              <SourceBadge serverId={g.serverId} />
              <span className="truncate">{g.name}</span>
            </h2>
            {g.status === 'success' && (
              <span className="num flex-none text-[13px] text-ink-3">
                {t('sources.sheetCount', { count: g.data?.groups.reduce((n, grp) => n + grp.items.length, 0) ?? 0 })}
              </span>
            )}
          </div>

          {g.status !== 'success' ? (
            <div className="sheet px-4 py-1">
              <SourceGroupState
                serverId={g.serverId}
                status={groupStateStatus(g)}
                error={g.error}
                onRetry={() => retry(g.serverId)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {g.data!.groups.map(group => (
                <TopListGroupCard key={group.title} serverId={g.serverId} group={group} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
