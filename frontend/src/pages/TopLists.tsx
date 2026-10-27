/**
 * 榜单列表页（阶段 2.6）：/toplists
 *
 * 首页的榜单卡只给摘要（每源两组、每组六个），截掉的榜从此有了去处。
 * 数据复用 useSourceTopLists（与首页同一条 query，缓存共享）。
 */

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
    <div className="pt-2 regular:pt-4 animate-fade-in">
      <h1 className="font-display text-[34px] regular:text-[40px] font-semibold leading-[1.05] tracking-[-0.02em]">
        {t('sources.topLists')}
      </h1>

      {groups.length === 0 && (
        <p className="mt-16 text-center text-[15px] text-ink-faint">
          {t('sources.topListsNone')}
        </p>
      )}

      {groups.map(g => (
        <section key={g.serverId} aria-labelledby={`toplists-${g.serverId}`}>
          <div className="section-head">
            <h2 id={`toplists-${g.serverId}`} className="flex items-center gap-2.5">
              <SourceBadge serverId={g.serverId} withName />
            </h2>
            {g.status === 'success' && (
              <span className="num text-[13px] text-ink-faint">
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
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-4">
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
