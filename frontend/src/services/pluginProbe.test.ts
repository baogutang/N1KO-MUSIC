/** 阶段 4.4：探测唯一实现——清定时器、三态判定 */
import { describe, expect, it, vi } from 'vitest'
import { probePluginUser } from '@/services/pluginProbe'
import { PluginCallError } from '@/plugins/host/PluginHost'

function host(user?: unknown, err?: unknown) {
  return {
    hasMethod: vi.fn(() => true),
    call: vi.fn(async () => {
      if (err) throw err
      return user
    }),
  } as unknown as Parameters<typeof probePluginUser>[0]
}

describe('probePluginUser（4.4）', () => {
  it('有用户 → ok；null → expired；unauthorized → expired', async () => {
    expect(await probePluginUser(host({ id: '1' }))).toBe('ok')
    expect(await probePluginUser(host(null))).toBe('expired')
    expect(await probePluginUser(host(undefined, new PluginCallError('unauthorized', '过期')))).toBe('expired')
  })

  it('其他错误 / 无方法 → unknown', async () => {
    expect(await probePluginUser(host(undefined, new Error('network')))).toBe('unknown')
    const noMethod = { hasMethod: vi.fn(() => false), call: vi.fn() } as unknown as Parameters<typeof probePluginUser>[0]
    expect(await probePluginUser(noMethod)).toBe('unknown')
  })

  it('超时 → unknown，且定时器被清（不再晚到覆盖）', async () => {
    const pending = { hasMethod: vi.fn(() => true), call: vi.fn(() => new Promise(() => undefined)) } as unknown as Parameters<typeof probePluginUser>[0]
    const result = await probePluginUser(pending, 30)
    expect(result).toBe('unknown')
  })
})
