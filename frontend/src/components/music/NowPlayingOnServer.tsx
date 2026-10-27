/**
 * 「此刻 · 服务器上」——同一台服务器上别人正在听什么。
 *
 * 家庭共享的 NAS 上这是个很有人味的栏目。做成几行文字，不是仪表盘部件。
 * 单用户服务器上没有别人在听，整块自动不出现。
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { detailPath } from '@/utils/detailPath'
import { getAdapter } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'
import { spaceCJK } from '@/utils/cjkTypography'
import { useT } from '@/i18n'

/** 服务器上「正在播放」的刷新间隔 */
const REFRESH_MS = 60_000

export function NowPlayingOnServer() {
  const { t } = useT()
  const navigate = useNavigate()
  const activeServerId = useServerStore(s => s.activeServerId)
  const isConnected = useServerStore(s => s.isConnected)
  const username = useServerStore(s => s.servers.find(x => x.id === s.activeServerId)?.username)
  const { nowPlaying } = useServerCapabilities()

  const { data } = useQuery({
    queryKey: [activeServerId ?? 'no-server', 'now-playing'],
    queryFn: () => getAdapter().getNowPlaying?.() ?? [],
    enabled: !!activeServerId && isConnected && nowPlaying,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  })

  // 只展示「别人」——自己在听什么播放条上就写着
  const others = (data ?? []).filter(entry => entry.username && entry.username !== username)
  if (!others.length) return null

  return (
    <section aria-labelledby="now-on-server">
      <div className="section-head">
        <h2 id="now-on-server">{t('nowPlaying.onServer')}</h2>
      </div>
      <ul>
        {others.slice(0, 6).map((entry, i) => (
          <li
            key={`${entry.username}-${entry.song.id}-${i}`}
            className="flex min-h-[56px] items-center gap-4 rounded-sm px-3 py-2 transition-colors duration-200 [@media(hover:hover)]:hover:bg-paper-deep"
          >
            <span className="w-16 flex-none truncate text-[13px] font-medium text-ink-soft regular:w-24">
              {entry.username}
            </span>
            <span className="min-w-0 flex-1">
              <button
                onClick={() => navigate(detailPath('songs', entry.song.id, entry.song.serverId), { state: { song: entry.song } })}
                className="-my-2 block max-w-full truncate rounded-sm py-2 text-left text-[15px] font-semibold transition-colors hover:text-primary"
              >
                {spaceCJK(entry.song.title)}
              </button>
              <span className="mt-0.5 block truncate text-[13px] text-ink-faint">
                {spaceCJK(entry.song.artist)}
              </span>
            </span>
            {entry.minutesAgo != null && (
              <span className="num flex-none text-[13px] text-ink-faint">
                {entry.minutesAgo === 0 ? t('nowPlaying.justNow') : t('nowPlaying.minutesAgo', { count: entry.minutesAgo })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
