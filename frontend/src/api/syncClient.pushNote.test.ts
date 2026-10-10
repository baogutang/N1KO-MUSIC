/**
 * 复审 B9：老后端（边注 PUT 还没有 updatedAt 字段的版本）zod .strict()
 * 会把新客户端的请求 400 掉——必须去字段重试一次，边注不能静默推不上。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const putMock = vi.fn()

vi.mock('axios', () => {
  const isAxiosError = (e: unknown) => !!(e && typeof e === 'object' && 'isAxiosError' in e)
  return {
    default: {
      create: () => ({ put: putMock }),
      isAxiosError,
    },
    isAxiosError,
  }
})

import { pushNote } from '@/api/syncClient'

beforeEach(() => {
  putMock.mockReset()
})

describe('pushNote 老后端 400 重试（B9）', () => {
  it('带 updatedAt 遇 400：去掉字段重试一次并成功', async () => {
    putMock.mockImplementation(async (_url: string, payload: Record<string, unknown>) => {
      if ('updatedAt' in payload) {
        throw Object.assign(new Error('Request failed with status code 400'), {
          isAxiosError: true,
          response: { status: 400 },
        })
      }
      return { data: { updatedAt: 1_700_000_000 } }
    })

    const result = await pushNote('https://sync.test', 'tok', {
      targetType: 'song', targetId: 's1', serverId: 'srv', body: '词', updatedAt: 1_700_000_500_000,
    })

    expect(putMock).toHaveBeenCalledTimes(2)
    expect('updatedAt' in (putMock.mock.calls[1][1] as object)).toBe(false)
    expect(result.updatedAt).toBe(1_700_000_000)
  })

  it('400 重试仍失败则抛出；非 400 不重试', async () => {
    putMock.mockRejectedValue(Object.assign(new Error('bad'), {
      isAxiosError: true, response: { status: 400 },
    }))
    await expect(pushNote('https://sync.test', 'tok', {
      targetType: 'song', targetId: 's1', serverId: 'srv', body: 'x', updatedAt: 1,
    })).rejects.toThrow()
    expect(putMock).toHaveBeenCalledTimes(2)

    putMock.mockReset()
    putMock.mockRejectedValue(Object.assign(new Error('oops'), {
      isAxiosError: true, response: { status: 500 },
    }))
    await expect(pushNote('https://sync.test', 'tok', {
      targetType: 'song', targetId: 's1', serverId: 'srv', body: 'x', updatedAt: 1,
    })).rejects.toThrow()
    expect(putMock).toHaveBeenCalledTimes(1)
  })

  it('不带 updatedAt 的调用（旧调用方）行为不变：一次成功', async () => {
    putMock.mockResolvedValue({ data: { updatedAt: 42 } })
    const result = await pushNote('https://sync.test', 'tok', {
      targetType: 'song', targetId: 's1', serverId: 'srv', body: 'x',
    })
    expect(putMock).toHaveBeenCalledTimes(1)
    expect(result.updatedAt).toBe(42)
  })
})
