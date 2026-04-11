import db from './database'

db.prepare('SELECT 1').get()
console.log('Database schema initialized successfully.')
db.close()
