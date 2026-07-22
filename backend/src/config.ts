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
