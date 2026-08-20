import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import db, { DATA_DIR } from '../db/database'
import { JWT_AUDIENCE, JWT_ISSUER, MIN_JWT_SECRET_LENGTH } from '../config'

// JWT 密钥：优先使用 JWT_SECRET 环境变量；未设置时在数据目录生成随机密钥并持久化（0600），
// 重启后复用。绝不回退到仓库中的固定字符串（否则任何人都能伪造令牌）
function loadOrCreateJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET
  if (envSecret) {
    // 显式提供的密钥必须有足够长度：短密钥可离线爆破后伪造任意令牌。
    // 不提供时下面会生成 48 字节随机密钥，反而更安全，所以这里宁可拒绝启动。
    if (envSecret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters ` +
        `(got ${envSecret.length}). Leave it unset to auto-generate a strong one.`
      )
    }
    return envSecret
  }

  const secretPath = path.join(DATA_DIR, 'jwt-secret')
  if (fs.existsSync(secretPath)) {
    const existing = fs.readFileSync(secretPath, 'utf-8').trim()
    if (existing) return existing
    throw new Error(`JWT secret file is empty: ${secretPath}`)
  }
  const secret = crypto.randomBytes(48).toString('hex')
  try {
    fs.writeFileSync(secretPath, secret, { mode: 0o600, flag: 'wx' })
    return secret
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = fs.readFileSync(secretPath, 'utf-8').trim()
    if (!existing) throw new Error(`JWT secret file is empty: ${secretPath}`)
    return existing
  }
}

const JWT_SECRET = loadOrCreateJwtSecret()

export interface AuthPayload {
  userId: string
  username: string
  tokenVersion?: number
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' })
  }

  const token = authHeader.substring(7)
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
    })
    if (
      typeof decoded === 'string' ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.username !== 'string' ||
      (decoded.tokenVersion !== undefined && typeof decoded.tokenVersion !== 'number')
    ) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    const payload: AuthPayload = {
      userId: decoded.userId,
      username: decoded.username,
      tokenVersion: decoded.tokenVersion,
    }
    // 校验 token_version：修改密码后版本递增，旧令牌（含无版本字段的历史令牌，视为 0）全部失效
    const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(payload.userId) as
      { token_version: number } | undefined
    if (!row || (payload.tokenVersion ?? 0) !== row.token_version) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    req.user = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
    expiresIn: '30d',
  })
}
