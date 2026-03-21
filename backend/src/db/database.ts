import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'music-stream-pro.db')

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export const db = new Database(DB_PATH)

// Initialize schema
const schemaPath = path.join(__dirname, 'schema.sql')
const schema = fs.readFileSync(schemaPath, 'utf-8')
db.exec(schema)

console.log(`Database initialized at ${DB_PATH}`)

export default db
