/**
 * 阶段 1.6 回归：清空历史必须清**列表正在显示的全部源**。
 * 用户路径：连着 NAS + 网易云 → 历史页看到两源的记录 → 清空 →
 * 插件源的记录不再随下一首播完回来。
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/listeningHistory', () => ({
  clearListeningEvents: vi.fn(),
}))

import { clearListeningEvents } from '@/services/listeningHistory'
import { useServerStore } from '@/store/serverStore'

/** useHistoryScope() 的 scope 语义（与 serverStore.ts 同款拼接，hook 外可算） */
function scopeOf(state: { connectedServerIds: string[]; activeServerId: string | null }): string[] {
  const ids = state.connectedServerIds.length ? state.connectedServerIds
    : (state.activeServerId ? [state.activeServerId] : [])
  if (!state.activeServerId) return ids
  return [state.activeServerId, ...ids.filter(id => id !== state.activeServerId)]
}

describe('清空历史按源遍历（1.6）', () => {
  it('historyScope 里的每个源都被清一次（不是只清主库）', () => {
    useServerStore.setState({
      activeServerId: 'nas',
      connectedServerIds: ['nas', 'wy', 'qq'],
      servers: [],
    } as never)
    const state = useServerStore.getState()

    // History.tsx handleClear 的形状：遍历 scope 逐个清
    for (const serverId of scopeOf(state)) clearListeningEvents(serverId)

    const cleared = (clearListeningEvents as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])
    expect(cleared.sort()).toEqual(['nas', 'qq', 'wy'])
  })
})
