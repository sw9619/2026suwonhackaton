import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : undefined,
})

// SQLite의 ? 플레이스홀더를 PostgreSQL의 $1, $2, ...로 변환
function toPostgres(sql: string): string {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

function processSQL(sql: string): string {
  let s = sql
  const wasInsertOrIgnore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)
  if (wasInsertOrIgnore) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO')
    if (!/ON\s+CONFLICT/i.test(s)) s += ' ON CONFLICT DO NOTHING'
  }
  return toPostgres(s)
}

const db = {
  async get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const { rows } = await pool.query(processSQL(sql), params)
    return rows[0] as T | undefined
  },

  async all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
    const { rows } = await pool.query(processSQL(sql), params)
    return rows as T[]
  },

  async run(sql: string, ...params: unknown[]): Promise<{ lastInsertRowid: number; changes: number }> {
    let s = processSQL(sql)
    const isInsert = /^\s*INSERT/i.test(s)
    if (isInsert && !/RETURNING/i.test(s)) s += ' RETURNING id'
    const { rows, rowCount } = await pool.query(s, params)
    return {
      lastInsertRowid: isInsert && rows[0] ? Number(rows[0].id) : 0,
      changes: rowCount ?? 0,
    }
  },

  async exec(sql: string): Promise<void> {
    await pool.query(sql)
  },
}

// 스키마 초기화 (앱 시작 시 한 번 실행)
export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT NOT NULL,
      gender TEXT NOT NULL,
      dept TEXT NOT NULL,
      student_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS verification_codes (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      type TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      host_id INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      team_gender TEXT NOT NULL,
      allow_duplicate INTEGER NOT NULL DEFAULT 1,
      status TEXT DEFAULT 'waiting',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (host_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS room_members (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      user_id INTEGER,
      nickname TEXT,
      text TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      room_id INTEGER UNIQUE NOT NULL,
      place TEXT NOT NULL,
      datetime_iso TEXT NOT NULL,
      accepted INTEGER DEFAULT 0,
      verified INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      rater_id INTEGER NOT NULL,
      ratee_id INTEGER NOT NULL,
      stars INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (room_id, rater_id, ratee_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS match_queue (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL,
      gender TEXT NOT NULL,
      size INTEGER NOT NULL,
      socket_id TEXT,
      joined_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS likes (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      liker_id INTEGER NOT NULL,
      likee_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (room_id, liker_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (liker_id) REFERENCES users(id),
      FOREIGN KEY (likee_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS room_kicks (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS appointment_accepts (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS appointment_verifies (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS pending_appointments (
      id SERIAL PRIMARY KEY,
      room_id INTEGER UNIQUE NOT NULL,
      place TEXT NOT NULL,
      datetime_iso TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      proposed_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS pending_appointment_accepts (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (room_id, user_id)
    );
  `)

  // 마이그레이션 (기존 테이블에 컬럼 추가)
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE rooms ADD COLUMN IF NOT EXISTS allow_duplicate INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION`,
    `ALTER TABLE appointments ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS noshow_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended INTEGER NOT NULL DEFAULT 0`,
  ]
  for (const sql of migrations) {
    try { await pool.query(sql) } catch { /* 이미 존재 */ }
  }

  console.log('[DB] PostgreSQL 스키마 초기화 완료')
}

export { pool }
export default db
