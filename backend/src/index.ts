import app from './app'
import { PORT, readPackageVersion } from './config'
import db from './db/database'

const server = app.listen(PORT, () => {
  console.log(`🎵 N1KO MUSIC Backend`)
  console.log(`   Listening on http://localhost:${PORT}`)
  console.log(`   Version: ${readPackageVersion()}`)
})

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received, shutting down...`)

  const forceExit = setTimeout(() => process.exit(1), 10_000)
  forceExit.unref()
  server.close(() => {
    db.close()
    clearTimeout(forceExit)
    process.exit(0)
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
