/** 阶段 8.3 回归：错误 → 文案的唯一映射 */
import { describe, expect, it } from 'vitest'
import { describeError, httpStatus, pluginErrorCode } from '@/services/errors'

describe('pluginErrorCode / httpStatus', () => {
  it('从对象上取协议错误码；形状不对返回 undefined', () => {
    expect(pluginErrorCode(Object.assign(new Error('x'), { code: 'unauthorized' }))).toBe('unauthorized')
    expect(pluginErrorCode(new Error('plain'))).toBeUndefined()
    expect(pluginErrorCode(null)).toBeUndefined()
    expect(pluginErrorCode('string')).toBeUndefined()
  })

  it('HTTP 状态从 axios 形状的 response 上取', () => {
    expect(httpStatus({ response: { status: 429 } })).toBe(429)
    expect(httpStatus(new Error('nope'))).toBeUndefined()
  })
})

describe('describeError', () => {
  it('协议错误码与 HTTP 状态都翻成 i18n 文案', () => {
    expect(describeError(Object.assign(new Error('x'), { code: 'rate-limited' }))).toBeTruthy()
    expect(describeError({ response: { status: 404 } })).toBeTruthy()
  })

  it('翻不出来返回 undefined——调用方回落通用文案，不亮原始 message', () => {
    expect(describeError(new Error('some raw english'))).toBeUndefined()
    expect(describeError(undefined)).toBeUndefined()
  })
})
