import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'music-stream-pro.db')

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const db = new Database(DB_PATH)

// Initialize schema (support both ts-node/src and built dist runtime)
const schemaCandidates = [
  path.join(__dirname, 'schema.sql'),
  path.join(process.cwd(), 'src', 'db', 'schema.sql'),
]
const schemaPath = schemaCandidates.find(p => fs.existsSync(p))
if (!schemaPath) {
  throw new Error(`Schema file not found. Tried: ${schemaCandidates.join(', ')}`)
}
const schema = fs.readFileSync(schemaPath, 'utf-8')
db.exec(schema)

console.log(`Database initialized at ${DB_PATH}`)

export default db
