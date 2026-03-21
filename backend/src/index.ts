import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'

import authRouter from './routes/auth'
import playlistsRouter from './routes/playlists'
import statsRouter from './routes/stats'

const app = express()
const PORT = Number(process.env.PORT ?? 3001)
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173'

// ===================================================
// Middleware
// ===================================================
app.use(helmet())
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(morgan('combined'))

// ===================================================
// Routes
// ===================================================
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRouter)
app.use('/api/playlists', playlistsRouter)
app.use('/api/stats', statsRouter)

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// ===================================================
// Start server
// ===================================================
app.listen(PORT, () => {
  console.log(`🎵 Music Stream Pro Backend`)
  console.log(`   Listening on http://localhost:${PORT}`)
  console.log(`   Frontend: ${FRONTEND_URL}`)
})

export default app
