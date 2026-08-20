import fs from 'fs'
import path from 'path'

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`)
  }
  return value
}

export const PORT = integerEnv('PORT', 3001, 1, 65535)
export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT ?? '2mb'
export const TRUST_PROXY_HOPS = integerEnv('TRUST_PROXY_HOPS', 0, 0, 10)
export const RATE_LIMIT_WINDOW_MS = integerEnv('RATE_LIMIT_WINDOW_MS', 15 * 60_000, 1_000, 86_400_000)
export const RATE_LIMIT_MAX = integerEnv('RATE_LIMIT_MAX', 600, 1, 100_000)
export const AUTH_RATE_LIMIT_MAX = integerEnv('AUTH_RATE_LIMIT_MAX', 20, 1, 10_000)
export const BCRYPT_ROUNDS = integerEnv('BCRYPT_ROUNDS', 12, 10, 15)
/**
 * 注册开关。
 *   'open'        任何人可注册
 *   'closed'      完全关闭
 *   'first-user'  （默认）库里还没有用户时允许注册，之后自动关闭
 *
 * 默认值刻意选 first-user：自建服务一旦暴露到公网，开放注册意味着任何人都能建号，
 * 而绝大多数部署只需要给自己开一个。
 */
export type RegistrationMode = 'open' | 'closed' | 'first-user'
export const REGISTRATION_MODE: RegistrationMode = (() => {
  const raw = (process.env.ALLOW_REGISTRATION ?? '').trim().toLowerCase()
  if (raw === 'open' || raw === 'true' || raw === '1') return 'open'
  if (raw === 'closed' || raw === 'false' || raw === '0') return 'closed'
  if (raw === 'first-user' || raw === '') return 'first-user'
  throw new Error("ALLOW_REGISTRATION must be one of: open, closed, first-user")
})()

/**
 * 单个账号的登录失败限制。
 * 全局限流按 IP 计，挡不住针对一个账号从多个出口地址发起的撞库。
 */
export const LOGIN_ATTEMPT_WINDOW_MS = integerEnv('LOGIN_ATTEMPT_WINDOW_MS', 15 * 60_000, 60_000, 86_400_000)
export const LOGIN_ATTEMPT_MAX = integerEnv('LOGIN_ATTEMPT_MAX', 10, 3, 1_000)

/**
 * 自定义 JWT_SECRET 的最小长度。
 * 未设置时中间件会自动生成 48 字节随机密钥并持久化；
 * 但用户显式传了一个短字符串时必须拒绝启动，否则可以离线爆破后伪造任意令牌。
 */
export const MIN_JWT_SECRET_LENGTH = 32

export const JWT_ISSUER = process.env.JWT_ISSUER ?? 'n1ko-music-backend'
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? 'n1ko-music-client'

const DEFAULT_FRONTEND_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
]

export const FRONTEND_ORIGINS = new Set([
  ...DEFAULT_FRONTEND_ORIGINS,
  ...(process.env.FRONTEND_URLS ?? process.env.FRONTEND_URL ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
])

export function readPackageVersion(): string {
  const candidates = [
    path.join(__dirname, '..', 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: unknown }
      if (typeof parsed.version === 'string' && parsed.version) return parsed.version
    } catch {
      // Try the next runtime layout.
    }
  }
  return 'unknown'
}
