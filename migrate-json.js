/**
 * One-time import of the old data/db.json into PostgreSQL.
 *   DATABASE_URL=postgres://... node migrate-json.js path/to/db.json
 * Plain-text passwords from the old file are hashed on the way in.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { Pool } = require('pg');
const scrypt = promisify(crypto.scrypt);

async function hash(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt, 64)).toString('hex')}`;
}
(async () => {
  const file = process.argv[2] || path.join(__dirname, 'data', 'db.json');
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first');
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    let u = 0, b = 0;
    for (const x of old.users || []) {
      const ph = x.passwordHash || (x.password ? await hash(String(x.password)) : null);
      if (!ph) continue;
      await c.query(
        `INSERT INTO users(id,email,name,phone,role,password_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [x.id, String(x.email).toLowerCase(), x.name || '', x.phone || '', x.role === 'admin' ? 'admin' : 'owner', ph]
      );
      u++;
    }
    for (const x of old.businesses || []) {
      await c.query('INSERT INTO businesses(id,owner_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING', [x.id, x.ownerId, JSON.stringify(x)]);
      b++;
    }
    for (const k of ['plans', 'platform', 'notices', 'platformUpdate']) {
      if (old[k] != null) await c.query('INSERT INTO config(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [k, JSON.stringify(old[k])]);
    }
    await c.query('COMMIT');
    console.log(`Imported ${u} users and ${b} businesses. Old sessions are not imported — everyone logs in again.`);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error('Import failed:', e.message); process.exit(1); });
