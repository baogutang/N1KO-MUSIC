/**
 * 榜单列表页（阶段 2.6）：/toplists
 *
 * 首页的榜单卡只给摘要（每源两组、每组六个），截掉的榜从此有了去处。
 * 数据复用 useSourceTopLists（与首页同一条 query，缓存共享）。
 */

import { useNavigate } from 'react-router-dom'
import { SourceBadge } from '@/components/sources/SourceBadge'
import { SourceGroupState, groupStateStatus } from '@/components/sources/SourceGroupState'
import { useSourceTopLists } from '@/hooks/useSourceQueries'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@/i18n'

export default function TopListsPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const groups = useSourceTopLists()

  const retry = (serverId: string) => {
    void queryClient.invalidateQueries({ queryKey: [serverId, 'toplists'] })
  }

  return (
    <div className="pt-9 animate-fade-in">
      <p className="text-[11px] uppercase tracking-[0.3em] text-primary">
        {t('sources.topListEyebrow')}
        <span className="latin-tag"> · CHARTS</span>
      </p>
      <h1 className="mt-3 font-serif text-4xl font-black tracking-[-0.01em] text-ink">
        {t('sources.topLists')}
      </h1>

      {groups.length === 0 && (
        <p className="mt-16 text-center font-serif text-[15px] text-ink-faint">
          {t('sources.topListsNone')}
        </p>
      )}

      <div className="mt-8 space-y-10">
        {groups.map(g => (
          <section key={g.serverId} aria-labelledby={`toplists-${g.serverId}`}>
            <div className="section-head">
              <h2 id={`toplists-${g.serverId}`} className="flex items-center gap-2.5">
                <SourceBadge serverId={g.serverId} withName />
              </h2>
              {g.status === 'success' && (
                <span className="num text-[11.5px] tracking-[0.12em] text-ink-faint">
                  {t('sources.sheetCount', { count: g.data?.groups.reduce((n, grp) => n + grp.items.length, 0) ?? 0 })}
                </span>
              )}
            </div>

            {g.status !== 'success' ? (
              <div className="px-2">
                <SourceGroupState
                  serverId={g.serverId}
                  status={groupStateStatus(g)}
                  error={g.error}
                  onRetry={() => retry(g.serverId)}
                />
              </div>
            ) : (
              <div className="border-t border-hair divide-y divide-hair-soft">
                {g.data!.groups.map(group => (
                  <div key={group.title} className="px-2 py-4">
                    <p className="mb-2.5 flex items-center gap-2.5">
                      <span className="font-serif text-[15px] font-semibold">{group.title}</span>
                      <span className="num text-[11px] text-ink-faint">
                        {t('sources.sheetCount', { count: group.items.length })}
                      </span>
                    </p>
                    <p className="flex flex-wrap gap-x-5 gap-y-1.5">
                      {group.items.map(item => (
                        <button
                          key={item.id}
                          onClick={() =>
                            navigate(`/toplists/${encodeURIComponent(g.serverId)}/${encodeURIComponent(item.id)}`)
                          }
                          className="border-b border-transparent text-[13px] text-ink-soft transition-colors duration-200 hover:border-primary hover:text-primary"
                        >
                          {item.name}
                        </button>
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
