/**
 * 「此刻 · 服务器上」——同一台服务器上别人正在听什么。
 *
 * 家庭共享的 NAS 上这是个很有人味的栏目。做成一段文字，不是仪表盘部件。
 * 单用户服务器上没有别人在听，整块自动不出现。
 */

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getAdapter } from '@/api'
import { useServerStore } from '@/store/serverStore'
import { useServerCapabilities } from '@/hooks/useServerCapabilities'
import { spaceCJK } from '@/utils/cjkTypography'

/** 服务器上「正在播放」的刷新间隔 */
const REFRESH_MS = 60_000

export function NowPlayingOnServer() {
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
        <h2 id="now-on-server">
          此刻 · 服务器上<small>NOW ON THE SERVER</small>
        </h2>
      </div>
      <ul className="border-t border-hair">
        {others.slice(0, 6).map((entry, i) => (
          <li
            key={`${entry.username}-${entry.song.id}-${i}`}
            className="flex items-baseline gap-4 border-b border-hair-soft px-2 py-3"
          >
            <span className="font-num w-20 flex-none truncate text-[11px] text-ink-faint">
              {entry.username}
            </span>
            <button
              onClick={() => navigate(`/songs/${entry.song.id}`, { state: { song: entry.song } })}
              className="min-w-0 flex-1 truncate text-left font-serif text-[15px] font-semibold transition-colors hover:text-primary"
            >
              {spaceCJK(entry.song.title)}
            </button>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-faint">
              {spaceCJK(entry.song.artist)}
            </span>
            {entry.minutesAgo != null && (
              <span className="font-num flex-none text-[11px] text-ink-faint">
                {entry.minutesAgo === 0 ? '刚刚' : `${entry.minutesAgo} 分钟前`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
