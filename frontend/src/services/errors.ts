/**
 * 错误 → 文案 的唯一映射（阶段 8.3）。
 *
 * 此前散着两种坏味道：
 *  1. `(e as { code }).code === 'unauthorized'` 的鸭子判断到处复制，
 *     换个写法/换层包装就漏判；
 *  2. 原始 `error.message`（插件作者随手写的自由文案、axios 的英文串）
 *     直接进 toast。
 * 这里给出：插件协议错误码 / HTTP 状态 → i18n 词条的唯一出口，
 * 以及类型化的取码函数。
 */

import { t } from '@/i18n'

/** 从任意抛出的东西上取协议错误码（PluginCallError / SerializedPluginError 形状） */
export function pluginErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** 是否 HTTP 状态类错误并取状态码 */
export function httpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const status = (error as { response?: { status?: unknown } }).response?.status
  return typeof status === 'number' ? status : undefined
}

/** PluginErrorCode → i18n key（services/errors.ts 的唯一词表） */
const CODE_MESSAGE_KEYS: Record<string, string> = {
  unauthorized: 'sources.authExpired',
  forbidden: 'sources.error.forbidden',
  'not-found': 'sources.error.notFound',
  'rate-limited': 'sources.rateLimitedPlain',
  network: 'sources.error.network',
  unsupported: 'sources.error.unsupported',
}

const STATUS_MESSAGE_KEYS: Record<number, string> = {
  401: 'sources.authExpired',
  403: 'sources.error.forbidden',
  404: 'sources.error.notFound',
  429: 'sources.rateLimitedPlain',
  500: 'sources.error.network',
  502: 'sources.error.network',
  503: 'sources.error.network',
}

/**
 * 把错误翻成「给用户看的一句话」。翻不出来（未知形状）返回 undefined——
 * 调用方应回落到通用文案，而不是把 error.message 亮出去。
 */
export function describeError(error: unknown): string | undefined {
  const code = pluginErrorCode(error)
  if (code && CODE_MESSAGE_KEYS[code]) return t(CODE_MESSAGE_KEYS[code])
  const status = httpStatus(error)
  if (status && STATUS_MESSAGE_KEYS[status]) return t(STATUS_MESSAGE_KEYS[status])
  return undefined
}
