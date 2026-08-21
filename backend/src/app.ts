import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { rateLimit } from 'express-rate-limit'

import db from './db/database'
import authRouter from './routes/auth'
import favoritesRouter from './routes/favorites'
import notesRouter from './routes/notes'
import playlistsRouter from './routes/playlists'
import statsRouter from './routes/stats'
import {
  AUTH_RATE_LIMIT_MAX,
  FRONTEND_ORIGINS,
  JSON_BODY_LIMIT,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  TRUST_PROXY_HOPS,
  readPackageVersion,
} from './config'

const app = express()
const version = readPackageVersion()

app.disable('x-powered-by')
if (TRUST_PROXY_HOPS > 0) app.set('trust proxy', TRUST_PROXY_HOPS)

app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    // Native clients and same-origin tools commonly omit Origin.
    if (!origin || FRONTEND_ORIGINS.has(origin)) return callback(null, true)
    return callback(null, false)
  },
  credentials: false,
}))
app.use(rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}))
app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }))
if (process.env.NODE_ENV !== 'test') app.use(morgan('combined'))

app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get()
    return res.json({ status: 'ok', version, timestamp: new Date().toISOString() })
  } catch {
    return res.status(503).json({ status: 'unavailable', version, timestamp: new Date().toISOString() })
  }
})

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
app.use('/api/auth', rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  limit: AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
}), authRouter)
app.use('/api/favorites', favoritesRouter)
app.use('/api/notes', notesRouter)
app.use('/api/playlists', playlistsRouter)
app.use('/api/stats', statsRouter)

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof SyntaxError || err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' })
  }
  console.error('Unhandled error:', err)
  return res.status(err.status ?? 500).json({ error: 'Internal server error' })
})

export default app
