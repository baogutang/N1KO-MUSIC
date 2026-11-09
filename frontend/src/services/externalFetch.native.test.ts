/**
 * 平板 / 手机上歌词接口走系统网络（CapacitorHttp）。
 *
 * 响应头是 application/json 时，iOS 和安卓的原生实现都不管 responseType，
 * 先把正文解析成对象再交回来。此前只认字符串，于是 JSON 歌词接口（自建 LrcApi 的 /jsonapi 等）
 * 拿到的永远是空文本：自动取词显示「无歌词」，手动搜索显示「未找到歌词」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { get },
}))

import { fetchExternalText } from './externalFetch'

beforeEach(() => get.mockReset())

describe('原生通道取文本', () => {
  it('JSON 响应被原生解析成了数组：还原成 JSON 文本', async () => {
    const list = [{ title: '勿忘心安', artist: '张杰', lyrics: '[00:01.00]第一句' }]
    get.mockResolvedValue({ status: 200, data: list, headers: { 'content-type': 'application/json; charset=utf-8' } })

    const res = await fetchExternalText('https://lrc.example/jsonapi?title=x')

    expect(res.ok).toBe(true)
    expect(JSON.parse(res.text)).toEqual(list)
    expect(res.contentType).toContain('application/json')
  })

  it('纯文本响应照旧', async () => {
    get.mockResolvedValue({ status: 200, data: '[00:01.00]第一句', headers: { 'Content-Type': 'text/plain' } })

    expect((await fetchExternalText('https://lrc.example/lyrics')).text).toBe('[00:01.00]第一句')
  })

  it('没有正文：空串', async () => {
    get.mockResolvedValue({ status: 404, data: null, headers: {} })

    const res = await fetchExternalText('https://lrc.example/lyrics')
    expect(res.ok).toBe(false)
    expect(res.text).toBe('')
  })
})
