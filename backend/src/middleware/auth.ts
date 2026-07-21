import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import db, { DATA_DIR } from '../db/database'

// JWT 密钥：优先使用 JWT_SECRET 环境变量；未设置时在数据目录生成随机密钥并持久化（0600），
// 重启后复用。绝不回退到仓库中的固定字符串（否则任何人都能伪造令牌）
function loadOrCreateJwtSecret(): string {
  const envSecret = process.env.JWT_SECRET
  if (envSecret) return envSecret

  const secretPath = path.join(DATA_DIR, 'jwt-secret')
  if (fs.existsSync(secretPath)) {
    const existing = fs.readFileSync(secretPath, 'utf-8').trim()
    if (existing) return existing
  }
  const secret = crypto.randomBytes(48).toString('hex')
  fs.writeFileSync(secretPath, secret, { mode: 0o600 })
  return secret
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
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload
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
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' })
}
