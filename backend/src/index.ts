import app from './app'
import { PORT, readPackageVersion } from './config'
import db from './db/database'
import { purgeExpiredTombstones } from './routes/favorites'
import { purgeExpiredNoteTombstones } from './routes/notes'

// 过期墓碑在启动时清一次就够：删除是低频操作，攒不出一天之内的问题，
// 而每次请求都扫一遍表纯属浪费。
const purged = purgeExpiredTombstones() + purgeExpiredNoteTombstones()
if (purged > 0) console.log(`   Purged ${purged} expired tombstones`)

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
