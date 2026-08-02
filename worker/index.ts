import { SignJWT, jwtVerify } from 'jose'
import * as bcrypt from 'bcryptjs'

export interface Env {
  DB: D1Database
  JWT_SECRET: string
  ADMIN_KEY: string
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  })
}

function error(msg: string, status = 400) {
  return json({ error: msg }, status)
}

async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10)
}

async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash)
}

async function createToken(username: string, uid: number, secret: string) {
  const key = new TextEncoder().encode(secret)
  return await new SignJWT({ sub: username, uid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key)
}

async function verifyToken(token: string, secret: string) {
  try {
    const key = new TextEncoder().encode(secret)
    const { payload } = await jwtVerify(token, key)
    return { username: payload.sub as string, uid: (payload.uid as number) ?? null }
  } catch {
    return null
  }
}

async function requireAuth(req: Request, env: Env) {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  return verifyToken(token, env.JWT_SECRET)
}

// Tokens issued before the uid claim existed fall back to a username lookup.
async function resolveUserId(env: Env, username: string, uid: number | null) {
  if (uid != null) return uid
  const row = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first<{ id: number }>()
  return row?.id ?? null
}

// Self-healing schema: baby profile columns for tables that predate them.
async function ensureBabySchema(env: Env) {
  const cols = await env.DB.prepare('PRAGMA table_info(baby)').all()
  const names = new Set(cols.results.map((c: any) => c.name))
  const adds: [string, string][] = [
    ['birth_weight', 'INTEGER DEFAULT 0'],
    ['gender', "TEXT DEFAULT ''"],
    ['unit', "TEXT DEFAULT 'ml'"],
  ]
  for (const [name, def] of adds) {
    if (!names.has(name)) {
      await env.DB.prepare(`ALTER TABLE baby ADD COLUMN ${name} ${def}`).run()
    }
  }
}

// Self-healing schema for log tables:
//  1. create weights if missing (new installs)
//  2. rebuild any log table still using `created_by` (username) → `user_id` (FK)
//  3. ensure timestamp indexes (hot path: sort + day bucketing)
async function ensureLogsSchema(env: Env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS weights (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    weight INTEGER NOT NULL,
    notes TEXT DEFAULT '',
    user_id INTEGER REFERENCES users(id)
  )`).run()

  const hasUserId = async (t: string) => {
    const cols = await env.DB.prepare(`PRAGMA table_info(${t})`).all()
    return cols.results.some((c: any) => c.name === 'user_id')
  }

  if (!(await hasUserId('feeds'))) {
    await env.DB.prepare('ALTER TABLE feeds RENAME TO feeds_old').run()
    await env.DB.prepare(`CREATE TABLE feeds (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      volume INTEGER DEFAULT 0,
      duration INTEGER DEFAULT 0,
      side TEXT,
      notes TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id)
    )`).run()
    await env.DB.prepare(`
      INSERT INTO feeds (id, timestamp, type, volume, duration, side, notes, user_id)
      SELECT x.id, x.timestamp, x.type, x.volume, x.duration, x.side, x.notes, COALESCE(u.id, (SELECT MIN(id) FROM users))
      FROM feeds_old x LEFT JOIN users u ON u.username = x.created_by
    `).run()
    await env.DB.prepare('DROP TABLE feeds_old').run()
  }

  if (!(await hasUserId('excretes'))) {
    await env.DB.prepare('ALTER TABLE excretes RENAME TO excretes_old').run()
    await env.DB.prepare(`CREATE TABLE excretes (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      color TEXT DEFAULT '',
      consistency TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id)
    )`).run()
    await env.DB.prepare(`
      INSERT INTO excretes (id, timestamp, type, color, consistency, notes, user_id)
      SELECT x.id, x.timestamp, x.type, x.color, x.consistency, x.notes, COALESCE(u.id, (SELECT MIN(id) FROM users))
      FROM excretes_old x LEFT JOIN users u ON u.username = x.created_by
    `).run()
    await env.DB.prepare('DROP TABLE excretes_old').run()
  }

  if (!(await hasUserId('weights'))) {
    await env.DB.prepare('ALTER TABLE weights RENAME TO weights_old').run()
    await env.DB.prepare(`CREATE TABLE weights (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      weight INTEGER NOT NULL,
      notes TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id)
    )`).run()
    await env.DB.prepare(`
      INSERT INTO weights (id, timestamp, weight, notes, user_id)
      SELECT x.id, x.timestamp, x.weight, x.notes, COALESCE(u.id, (SELECT MIN(id) FROM users))
      FROM weights_old x LEFT JOIN users u ON u.username = x.created_by
    `).run()
    await env.DB.prepare('DROP TABLE weights_old').run()
  }

  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_feeds_timestamp ON feeds(timestamp)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_excretes_timestamp ON excretes(timestamp)').run()
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_weights_timestamp ON weights(timestamp)').run()
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    // Public: Login
    if (path === '/api/login' && req.method === 'POST') {
      const { username, password } = await req.json()
      if (!username || !password) return error('Missing fields')

      const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?')
        .bind(username).first<{ id: number; password_hash: string }>()

      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return error('Invalid credentials', 401)
      }

      const token = await createToken(username, user.id, env.JWT_SECRET)
      return json({ token, username })
    }

    // Admin only: Create user
    if (path === '/api/admin/create-user' && req.method === 'POST') {
      const { username, password, admin_key } = await req.json()
      if (admin_key !== env.ADMIN_KEY) return error('Invalid admin key', 403)
      if (!username || !password) return error('Missing fields')

      const hash = await hashPassword(password)
      try {
        await env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
          .bind(username, hash).run()
        return json({ success: true, username })
      } catch (e: any) {
        return error('User already exists or DB error')
      }
    }

    // All other routes require auth
    const auth = await requireAuth(req, env)
    if (!auth) return error('Unauthorized', 401)
    const { username, uid } = auth

    await ensureBabySchema(env)
    await ensureLogsSchema(env)

    // GET all data (shared)
    if (path === '/api/data' && req.method === 'GET') {
      const baby = await env.DB.prepare('SELECT * FROM baby WHERE id = 1').first()
      const feeds = await env.DB.prepare('SELECT * FROM feeds ORDER BY timestamp DESC').all()
      const excretes = await env.DB.prepare('SELECT * FROM excretes ORDER BY timestamp DESC').all()
      const weights = await env.DB.prepare('SELECT * FROM weights ORDER BY timestamp DESC').all()
      return json({ baby, feeds: feeds.results, excretes: excretes.results, weights: weights.results })
    }

    // Add feed
    if (path === '/api/feeds' && req.method === 'POST') {
      const log = await req.json()
      const id = log.id || crypto.randomUUID()
      const userId = await resolveUserId(env, username, uid)
      await env.DB.prepare(`
        INSERT INTO feeds (id, timestamp, type, volume, duration, side, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, log.timestamp, log.type, log.volume || 0, log.duration || 0, log.side || null, log.notes || '', userId).run()
      return json({ success: true, id })
    }

    // Add excrete
    if (path === '/api/excretes' && req.method === 'POST') {
      const log = await req.json()
      const id = log.id || crypto.randomUUID()
      const userId = await resolveUserId(env, username, uid)
      await env.DB.prepare(`
        INSERT INTO excretes (id, timestamp, type, color, consistency, notes, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, log.timestamp, log.type, log.color || '', log.consistency || '', log.notes || '', userId).run()
      return json({ success: true, id })
    }

    // Add weight
    if (path === '/api/weights' && req.method === 'POST') {
      const log = await req.json()
      const id = log.id || crypto.randomUUID()
      const userId = await resolveUserId(env, username, uid)
      await env.DB.prepare('INSERT INTO weights (id, timestamp, weight, notes, user_id) VALUES (?, ?, ?, ?, ?)')
        .bind(id, log.timestamp, log.weight || 0, log.notes || '', userId).run()
      return json({ success: true, id })
    }

    // Delete log (feed, excrete or weight)
    if (path === '/api/logs' && req.method === 'DELETE') {
      const { id, kind } = await req.json()
      if (kind === 'feed') {
        await env.DB.prepare('DELETE FROM feeds WHERE id = ?').bind(id).run()
      } else if (kind === 'weight') {
        await env.DB.prepare('DELETE FROM weights WHERE id = ?').bind(id).run()
      } else {
        await env.DB.prepare('DELETE FROM excretes WHERE id = ?').bind(id).run()
      }
      return json({ success: true })
    }

    // Clear all records
    if (path === '/api/logs/all' && req.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM feeds').run()
      await env.DB.prepare('DELETE FROM excretes').run()
      await env.DB.prepare('DELETE FROM weights').run()
      return json({ success: true })
    }

    // Update baby profile
    if (path === '/api/baby' && req.method === 'POST') {
      const b = await req.json()
      await env.DB.prepare('UPDATE baby SET name = ?, dob = ?, notes = ?, birth_weight = ?, gender = ?, unit = ? WHERE id = 1')
        .bind(b.name, b.dob, b.notes || '', b.birthWeight || 0, b.gender || '', b.unit || 'ml').run()
      return json({ success: true })
    }

    return error('Not found', 404)
  }
}
