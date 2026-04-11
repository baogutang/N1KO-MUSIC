import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const rawJwtSecret = process.env.JWT_SECRET
const isProduction = process.env.NODE_ENV === 'production'

if (isProduction && !rawJwtSecret) {
  throw new Error('JWT_SECRET must be set in production environment')
}

if (!rawJwtSecret) {
  console.warn('[auth] JWT_SECRET is not set, using development fallback secret')
}

const JWT_SECRET = rawJwtSecret ?? 'msp-dev-secret-change-in-production'

export interface AuthPayload {
  userId: string
  username: string
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
    req.user = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' })
}
