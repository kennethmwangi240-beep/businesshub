/**
 * BusinessHub Kenya — API + static app server
 * Storage: PostgreSQL (any host) via DATABASE_URL.  Node 18+, one dependency: pg.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const { Pool } = require('pg');

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT) || 3847;
const PUBLIC = path.join(__dirname, 'public');
const SESSION_DAYS = 30;
const MAX_BODY = 10 * 1024 * 1024;
const MIN_PASSWORD = 8;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required (e.g. postgres://user:pass@host:5432/dbname)');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 10
});
pool.on('error', (e) => console.error('pg pool error', e.message));

const DEFAULT_PLANS = {
  FREE: { name: 'Free', price: 0, bizLimit: 1, label: 'Free trial' },
  PRO: { name: 'Pro', price: 1500, bizLimit: 3, label: 'Pro · KES 1,500/mo' },
  BUSINESS: { name: 'Business', price: 4500, bizLimit: 10, label: 'Business · KES 4,500/mo' }
};
const DEFAULT_PLATFORM = {
  company: 'BusinessHub Kenya', ownerName: '', phone: '', email: '', address: '', city: 'Nairobi',
  country: 'Kenya', mpesaTill: '', paybill: '', bankName: '', bankAccount: '', supportEmail: '', website: '', notes: ''
};
// Fields a business owner may never set themselves
const OWNER_LOCKED = ['id', 'ownerId', 'suspended', 'trialEndsAt', 'trialExtended'];
const HEAVY = ['orders', 'customers', 'quotations', 'expenses', 'purchases', 'cart'];

/* ---------- helpers ---------- */
const uid = () => crypto.randomBytes(8).toString('hex');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => fmt(new Date());
function addDays(dayStr, n) {
  const p = String(dayStr || today()).slice(0, 10).split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + n);
  return fmt(d);
}
const str = (v, max = 200) => String(v == null ? '' : v).slice(0, max);

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const calc = await scrypt(pw, Buffer.from(s, 'hex'), 64);
  const exp = Buffer.from(h, 'hex');
  return exp.length === calc.length && crypto.timingSafeEqual(calc, exp);
}
let DUMMY_HASH; // used so unknown emails cost the same time as wrong passwords

/* ---------- rate limiting (in-memory, per instance) ---------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return false; }
  e.n++;
  return e.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of hits) if (e.reset < now) hits.delete(k); }, 60000).unref();
function clientIp(req) {
  // Hosts append the real client IP last; earlier entries can be spoofed by the client.
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket.remoteAddress || '?';
}

/* ---------- http helpers ---------- */
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function tokenFrom(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

/* ---------- data layer ---------- */
async function getCfg(key, def, c = pool) {
  const r = await c.query('SELECT value FROM config WHERE key=$1', [key]);
  return r.rows.length ? r.rows[0].value : def;
}
async function setCfg(key, val, c = pool) {
  await c.query(
    'INSERT INTO config(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
    [key, JSON.stringify(val)]
  );
}
async function authUser(req) {
  const t = tokenFrom(req);
  if (!t) return null;
  const r = await pool.query(
    'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
    [sha(t)]
  );
  return r.rows[0] || null;
}
const isAdmin = (u) => !!u && u.role === 'admin';
const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name || '', role: u.role || 'owner', phone: u.phone || '' } : null);
async function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query("INSERT INTO sessions VALUES($1,$2,now()+($3::int * interval '1 day'))", [sha(token), userId, SESSION_DAYS]);
  return token;
}
const bizOut = (r) => ({ ...r.data, id: r.id, ownerId: r.owner_id });

function emptyBiz(ownerId, extra) {
  const clean = { ...(extra || {}) };
  ['id', 'ownerId', 'plan', 'suspended', 'trialEndsAt', 'trialExtended', 'planPaidAt', 'planReceipt', 'createdAt'].forEach((k) => delete clean[k]);
  return {
    id: uid(), ownerId, name: '', phone: '', address: '', payinfo: '', currency: 'KES', categories: [],
    categoryLabel: '', color: '#0d9488', salesPin: '', onlineStore: true, products: [], cart: [], orders: [],
    customers: [], quotations: [], expenses: [], purchases: [], orderN: 0, qtN: 0, purN: 0, onlineN: 0,
    payments: { provider: 'mpesa' },
    ...clean,
    plan: 'FREE', suspended: false, createdAt: today(), trialEndsAt: addDays(today(), 3)
  };
}
// read-modify-write one business under a row lock
async function withBiz(id, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query('SELECT * FROM businesses WHERE id=$1 FOR UPDATE', [id]);
    if (!r.rows.length) { await c.query('ROLLBACK'); return { status: 404, body: { error: 'Not found' } }; }
    const out = await fn(bizOut(r.rows[0]), c);
    if (out.save) await c.query('UPDATE businesses SET data=$2::jsonb WHERE id=$1', [id, JSON.stringify(out.save)]);
    await c.query('COMMIT');
    return out;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  DUMMY_HASH = await hashPassword(crypto.randomBytes(8).toString('hex'));
  if (!(await pool.query('SELECT 1 FROM config WHERE key=$1', ['plans'])).rows.length) await setCfg('plans', DEFAULT_PLANS);
  if (!(await pool.query('SELECT 1 FROM config WHERE key=$1', ['platform'])).rows.length) await setCfg('platform', DEFAULT_PLATFORM);
  // Admin is created from env vars — there is no public "first come first served" admin signup.
  const adminEmail = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const adminPass = String(process.env.ADMIN_PASSWORD || '');
  const hasAdmin = (await pool.query("SELECT 1 FROM users WHERE role='admin'")).rows.length > 0;
  if (!hasAdmin) {
    if (adminEmail && adminPass.length >= MIN_PASSWORD) {
      await pool.query(
        `INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Admin','admin',$3)
         ON CONFLICT(email) DO UPDATE SET role='admin', password_hash=EXCLUDED.password_hash`,
        [uid(), adminEmail, await hashPassword(adminPass)]
      );
      const p = await getCfg('platform', DEFAULT_PLATFORM);
      await setCfg('platform', { ...p, email: p.email || adminEmail });
      console.log('Admin account created for', adminEmail, '(you may now remove ADMIN_PASSWORD from the environment)');
    } else {
      console.warn(`No admin exists. Set ADMIN_EMAIL and ADMIN_PASSWORD (min ${MIN_PASSWORD} chars) and restart.`);
    }
  }
  // Recovery: set ADMIN_EMAIL + ADMIN_PASSWORD + ADMIN_RESET=true, redeploy, log in, then remove ADMIN_RESET.
  if (hasAdmin && process.env.ADMIN_RESET === 'true' && adminEmail && adminPass.length >= MIN_PASSWORD) {
    const r = await pool.query("UPDATE users SET email=$1, password_hash=$2 WHERE role='admin'", [adminEmail, await hashPassword(adminPass)]);
    if (r.rowCount) { await pool.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='admin')"); console.log('Admin credentials reset for', adminEmail, '- now remove ADMIN_RESET'); }
  }
  await pool.query('DELETE FROM sessions WHERE expires_at<now()');
  setInterval(() => pool.query('DELETE FROM sessions WHERE expires_at<now()').catch(() => {}), 3600000).unref();
}

/* ---------- API ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleApi(req, res, pathname) {
  const method = req.method;
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const ip = clientIp(req);
  if (limited('api:' + ip, 300, 60000)) return json(res, 429, { error: 'Too many requests, slow down' });

  if (pathname === '/api/health' && method === 'GET') {
    await pool.query('SELECT 1');
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/register' && method === 'POST') {
    if (limited('reg:' + ip, 10, 3600000)) return json(res, 429, { error: 'Too many sign-ups from this network' });
    const body = await readBody(req);
    const email = str(body.email, 254).toLowerCase().trim();
    const password = String(body.password || '');
    if (!EMAIL_RE.test(email) || password.length < MIN_PASSWORD || password.length > 200) {
      return json(res, 400, { error: `Valid email and password (min ${MIN_PASSWORD}) required` });
    }
    const id = uid();
    try {
      await pool.query(
        "INSERT INTO users(id,email,name,phone,role,password_hash) VALUES($1,$2,$3,$4,'owner',$5)",
        [id, email, str(body.name), str(body.phone, 40), await hashPassword(password)]
      );
    } catch (e) {
      if (e.code === '23505') return json(res, 409, { error: 'Email already registered' });
      throw e;
    }
    const user = (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
    return json(res, 201, { token: await newSession(id), user: publicUser(user) });
  }

  if (pathname === '/api/admin/register' && method === 'POST') {
    return json(res, 403, { error: 'Admin signup is disabled. Set ADMIN_EMAIL and ADMIN_PASSWORD on the server, then log in.' });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    const email = str(body.email, 254).toLowerCase().trim();
    const password = String(body.password || '').slice(0, 200);
    if (limited('login-ip:' + ip, 30, 900000) || limited('login-em:' + email, 8, 900000)) {
      return json(res, 429, { error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    const user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) return json(res, 401, { error: 'Invalid email or password' });
    if (body.adminOnly && !isAdmin(user)) return json(res, 403, { error: 'Not a platform admin account' });
    if (!body.adminOnly && isAdmin(user) && body.clientOnly) return json(res, 403, { error: 'Use admin login for this account' });
    return json(res, 200, { token: await newSession(user.id), user: publicUser(user), isAdmin: isAdmin(user) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const t = tokenFrom(req);
    if (t) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [sha(t)]);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    return json(res, 200, {
      user: publicUser(u), isAdmin: isAdmin(u),
      plans: await getCfg('plans', DEFAULT_PLANS), platformUpdate: await getCfg('platformUpdate', null)
    });
  }

  if (pathname === '/api/notices' && method === 'GET') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    return json(res, 200, { notices: await getCfg('notices', []), platformUpdate: await getCfg('platformUpdate', null) });
  }

  if (pathname === '/api/businesses' && method === 'GET') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const r = isAdmin(u)
      ? await pool.query('SELECT * FROM businesses ORDER BY created_at')
      : await pool.query('SELECT * FROM businesses WHERE owner_id=$1 ORDER BY created_at', [u.id]);
    return json(res, 200, { businesses: r.rows.map(bizOut) });
  }

  if (pathname === '/api/businesses' && method === 'POST') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    if (isAdmin(u)) return json(res, 403, { error: 'Admin cannot create client businesses here' });
    const body = await readBody(req);
    const mine = (await pool.query('SELECT data FROM businesses WHERE owner_id=$1 ORDER BY created_at', [u.id])).rows;
    const plans = await getCfg('plans', DEFAULT_PLANS);
    const planKey = mine[0]?.data?.plan || 'FREE';
    const limit = (plans[planKey] || DEFAULT_PLANS.FREE).bizLimit || 1;
    if (mine.length >= limit) return json(res, 403, { error: 'Plan business limit reached' });
    const b = emptyBiz(u.id, body);
    await pool.query('INSERT INTO businesses(id,owner_id,data) VALUES($1,$2,$3::jsonb)', [b.id, u.id, JSON.stringify(b)]);
    return json(res, 201, { business: b });
  }

  const bizMatch = pathname.match(/^\/api\/businesses\/([^/]+)$/);
  if (bizMatch) {
    const id = bizMatch[1];
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const row = (await pool.query('SELECT * FROM businesses WHERE id=$1', [id])).rows[0];
    if (!row) return json(res, 404, { error: 'Not found' });
    if (!isAdmin(u) && row.owner_id !== u.id) return json(res, 403, { error: 'Forbidden' });

    if (method === 'GET') return json(res, 200, { business: bizOut(row) });

    if (method === 'PUT' || method === 'PATCH') {
      const body = await readBody(req);
      const out = await withBiz(id, async (b) => {
        let nb;
        if (!isAdmin(u)) {
          nb = { ...b, ...body };
          OWNER_LOCKED.forEach((k) => { nb[k] = b[k]; }); // server keeps control of these
        } else {
          nb = { ...b };
          ['plan', 'suspended', 'trialEndsAt', 'trialExtended', 'name', 'salesPin', 'pinLocked', 'pinFails', 'pinLockedAt'].forEach((k) => { if (body[k] !== undefined) nb[k] = body[k]; });
          if (body.plan && body.plan !== 'FREE') {
            nb.planPaidAt = today();
            nb.planReceipt = b.planReceipt || 'ADMIN-' + Date.now();
          }
        }
        nb.id = id; nb.ownerId = row.owner_id;
        return { save: nb, status: 200, body: { business: nb } };
      });
      return json(res, out.status, out.body);
    }

    if (method === 'DELETE') {
      await pool.query('DELETE FROM businesses WHERE id=$1', [id]);
      return json(res, 200, { ok: true });
    }
  }

  if (pathname === '/api/admin/overview' && method === 'GET') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const clients = (await pool.query("SELECT * FROM users WHERE role<>'admin' ORDER BY created_at")).rows;
    const bizs = (await pool.query(
      `SELECT id, owner_id, data->>'name' AS name, data->>'plan' AS plan, data->>'suspended' AS suspended,
              data->>'createdAt' AS "createdAt", data->>'trialEndsAt' AS "trialEndsAt", data->'onlineStore' AS "onlineStore"
       FROM businesses ORDER BY created_at`
    )).rows;
    const planCounts = {};
    bizs.forEach((b) => { const k = b.plan || 'FREE'; planCounts[k] = (planCounts[k] || 0) + 1; });
    return json(res, 200, {
      clients: clients.map(publicUser),
      businesses: bizs.map((b) => ({
        id: b.id,
        name: b.name || 'Unnamed',
        ownerId: b.owner_id,
        plan: b.plan || 'FREE',
        suspended: b.suspended === true || b.suspended === 'true',
        createdAt: b.createdAt,
        trialEndsAt: b.trialEndsAt,
        onlineStore: b.onlineStore !== false && b.onlineStore !== 'false'
      })),
      planCounts, plans: await getCfg('plans', DEFAULT_PLANS), platform: await getCfg('platform', DEFAULT_PLATFORM),
      notices: await getCfg('notices', []),
      totals: { clients: clients.length, businesses: bizs.length, suspended: bizs.filter((b) => b.suspended === 'true').length }
    });
  }

  if (pathname === '/api/admin/users/reset-password' && method === 'POST') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    const password = String(body.password || '');
    if (password.length < MIN_PASSWORD || password.length > 200) return json(res, 400, { error: `New password required (min ${MIN_PASSWORD})` });
    const r = await pool.query("UPDATE users SET password_hash=$2 WHERE id=$1 AND role<>'admin'", [String(body.userId), await hashPassword(password)]);
    if (!r.rowCount) return json(res, 404, { error: 'User not found' });
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [String(body.userId)]);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/users' && method === 'DELETE') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    const uidDel = String(body.userId || '');
    if (!uidDel) return json(res, 400, { error: 'userId required' });
    const target = (await pool.query('SELECT id, role FROM users WHERE id=$1', [uidDel])).rows[0];
    if (!target) return json(res, 404, { error: 'User not found' });
    if (target.role === 'admin') return json(res, 403, { error: 'Cannot delete admin' });
    // Remove businesses first, then sessions, then user
    await pool.query('DELETE FROM businesses WHERE owner_id=$1', [uidDel]);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [uidDel]);
    await pool.query("DELETE FROM users WHERE id=$1 AND role<>'admin'", [uidDel]);
    return json(res, 200, { ok: true, deleted: uidDel });
  }


  if (pathname === '/api/auth/forgot' && method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    if (!email) return json(res, 400, { error: 'Email required' });
    const u = (await pool.query('SELECT id, email, name, role FROM users WHERE email=$1', [email])).rows[0];
    if (!u) return json(res, 200, { ok: true, message: 'If that email exists, a recovery code was issued.' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const tokens = await getCfg('resetTokens', {});
    tokens[email] = { code, userId: u.id, expires: Date.now() + 30 * 60 * 1000 };
    await setCfg('resetTokens', tokens);
    const alerts = await getCfg('adminAlerts', []);
    alerts.push({ id: uid(), type: 'password_reset_request', email, userId: u.id, name: u.name || '', at: new Date().toISOString(), message: 'Password recovery requested for ' + email });
    await setCfg('adminAlerts', alerts.slice(-100));
    return json(res, 200, { ok: true, message: 'Recovery code generated (valid 30 min).', recoveryCode: code, hint: 'No email SMTP — use this code now or ask admin to reset password.' });
  }

  if (pathname === '/api/auth/reset' && method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const code = String(body.code || '').trim();
    const password = String(body.password || '');
    if (!email || !code || password.length < MIN_PASSWORD) return json(res, 400, { error: 'Email, recovery code and new password required' });
    const tokens = await getCfg('resetTokens', {});
    const t = tokens[email];
    if (!t || String(t.code) !== code || Date.now() > (t.expires || 0)) return json(res, 400, { error: 'Invalid or expired recovery code' });
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [t.userId, await hashPassword(password)]);
    delete tokens[email];
    await setCfg('resetTokens', tokens);
    return json(res, 200, { ok: true, message: 'Password updated' });
  }

  if (pathname === '/api/admin/alerts' && method === 'GET') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    return json(res, 200, { alerts: await getCfg('adminAlerts', []) });
  }

  if (pathname === '/api/admin/alerts' && method === 'DELETE') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    let alerts = await getCfg('adminAlerts', []);
    if (body.clearAll) alerts = [];
    else alerts = alerts.filter((a) => a.id !== body.id);
    await setCfg('adminAlerts', alerts);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/pin-lock' && method === 'POST') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const bizId = String(body.businessId || '');
    const row = (await pool.query('SELECT * FROM businesses WHERE id=$1', [bizId])).rows[0];
    if (!row) return json(res, 404, { error: 'Business not found' });
    if (!isAdmin(u) && row.owner_id !== u.id) return json(res, 403, { error: 'Forbidden' });
    const b = bizOut(row);
    b.pinLocked = true;
    b.pinFails = Number(body.fails || 2);
    b.pinLockedAt = new Date().toISOString();
    await pool.query('UPDATE businesses SET data=$2::jsonb WHERE id=$1', [bizId, JSON.stringify(b)]);
    const alerts = await getCfg('adminAlerts', []);
    alerts.push({ id: uid(), type: 'pin_locked', businessId: bizId, businessName: b.name || '', ownerId: row.owner_id, at: new Date().toISOString(), message: 'Sales PIN locked after failed attempts: ' + (b.name || bizId) });
    await setCfg('adminAlerts', alerts.slice(-100));
    return json(res, 200, { ok: true, business: b });
  }

  if (pathname === '/api/admin/pin-unlock' && method === 'POST') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    const bizId = String(body.businessId || '');
    const row = (await pool.query('SELECT * FROM businesses WHERE id=$1', [bizId])).rows[0];
    if (!row) return json(res, 404, { error: 'Business not found' });
    const b = bizOut(row);
    b.pinLocked = false;
    b.pinFails = 0;
    b.pinLockedAt = null;
    if (body.newPin && /^\d{4,6}$/.test(String(body.newPin))) b.salesPin = String(body.newPin);
    await pool.query('UPDATE businesses SET data=$2::jsonb WHERE id=$1', [bizId, JSON.stringify(b)]);
    return json(res, 200, { ok: true, business: b });
  }

  if (pathname === '/api/admin/plans' && method === 'PUT') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    if (body.plans && typeof body.plans === 'object' && !Array.isArray(body.plans)) await setCfg('plans', body.plans);
    return json(res, 200, { plans: await getCfg('plans', DEFAULT_PLANS) });
  }

  if (pathname === '/api/admin/platform' && method === 'PUT') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    const platform = { ...(await getCfg('platform', DEFAULT_PLATFORM)), ...body };
    await setCfg('platform', platform);
    return json(res, 200, { platform });
  }

  if (pathname === '/api/admin/notices' && method === 'POST') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    const notice = { id: uid(), title: str(body.title), body: str(body.body, 5000), date: today() };
    await setCfg('notices', [...(await getCfg('notices', [])), notice]);
    await setCfg('platformUpdate', { at: new Date().toISOString(), title: notice.title, body: notice.body });
    return json(res, 201, { notice });
  }

  if (pathname === '/api/admin/notices' && method === 'DELETE') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    await setCfg('notices', (await getCfg('notices', [])).filter((n) => n.id !== body.id));
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/public/shops' && method === 'GET') {
    const r = await pool.query(`SELECT id, owner_id, data - 'orders' - 'customers' - 'quotations' - 'expenses' - 'purchases' - 'cart' AS data FROM businesses`);
    const shops = r.rows.map(bizOut)
      .filter((b) => b.onlineStore !== false && b.name && !b.suspended)
      .map((b) => ({
        id: b.id, name: b.name, color: b.color, phone: b.phone, address: b.address, categoryLabel: b.categoryLabel,
        productCount: (b.products || []).filter((p) => p.active !== false && (p.stock || 0) > 0).length
      }));
    return json(res, 200, { shops });
  }

  const shopMatch = pathname.match(/^\/api\/public\/shops\/([^/]+)$/);
  if (shopMatch && method === 'GET') {
    const r = await pool.query(`SELECT id, owner_id, data - 'orders' - 'customers' - 'quotations' - 'expenses' - 'purchases' - 'cart' AS data FROM businesses WHERE id=$1`, [shopMatch[1]]);
    const b = r.rows[0] && bizOut(r.rows[0]);
    if (!b || b.onlineStore === false || b.suspended) return json(res, 404, { error: 'Shop not found' });
    return json(res, 200, {
      shop: {
        id: b.id, name: b.name, color: b.color, phone: b.phone, address: b.address, categoryLabel: b.categoryLabel,
        products: (b.products || []).filter((p) => p.active !== false && (p.stock || 0) > 0),
        payments: { till: b.payments?.till || b.payinfo, provider: b.payments?.provider }
      }
    });
  }

  const orderMatch = pathname.match(/^\/api\/public\/shops\/([^/]+)\/orders$/);
  if (orderMatch && method === 'POST') {
    if (limited('order:' + ip, 15, 600000)) return json(res, 429, { error: 'Too many orders, try again later' });
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 50) return json(res, 400, { error: 'Order needs 1–50 items' });
    const out = await withBiz(orderMatch[1], async (b) => {
      if (b.onlineStore === false || b.suspended) return { status: 404, body: { error: 'Shop not found' } };
      const products = b.products || [];
      let total = 0;
      const lines = [];
      for (const it of items) {
        const qty = Number(it.qty);
        const p = products.find((x) => x.id === it.product_id);
        if (!p || p.active === false || !Number.isInteger(qty) || qty < 1 || qty > 1000) {
          return { status: 400, body: { error: 'Invalid item in order' } };
        }
        if ((p.stock || 0) < qty) return { status: 409, body: { error: `Not enough stock for ${p.name || 'item'}` } };
        const price = Number(p.price ?? p.sellPrice ?? it.price);
        if (!Number.isFinite(price) || price < 0) return { status: 400, body: { error: 'Invalid price' } };
        total += price * qty;
        lines.push({ ...it, qty, price, p });
      }
      lines.forEach((l) => { l.p.stock = Math.max(0, (l.p.stock || 0) - l.qty); });
      b.onlineN = (b.onlineN || 0) + 1;
      b.orderN = (b.orderN || 0) + 1;
      const order = {
        id: uid(), number: 'WEB-' + String(b.onlineN).padStart(4, '0'), date: today(),
        items: lines.map(({ p, ...rest }) => rest), total: Math.round(total * 100) / 100,
        status: 'PENDING', // payment is confirmed by the shop owner, never by the customer
        payMethod: str(body.payMethod || 'mpesa', 30), phone: str(body.phone, 40), customerName: str(body.customerName),
        fulfillment: body.fulfillment === 'delivery' ? 'delivery' : 'pickup', deliveryAddress: str(body.deliveryAddress, 300),
        receipt: str(body.receipt || 'PENDING-PAY', 60), source: 'online'
      };
      b.orders = [...(b.orders || []), order];
      return { save: b, status: 201, body: { order } };
    });
    return json(res, out.status, out.body);
  }

  if (pathname === '/api/admin/backup' && method === 'GET') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const users = (await pool.query('SELECT * FROM users ORDER BY created_at')).rows
      .map((x) => ({ ...publicUser(x), passwordHash: x.password_hash }));
    const businesses = (await pool.query('SELECT * FROM businesses ORDER BY created_at')).rows.map(bizOut);
    return json(res, 200, {
      type: 'businesshub_admin_backup', version: 2, exportedAt: new Date().toISOString(),
      data: {
        users, businesses, plans: await getCfg('plans', DEFAULT_PLANS), platform: await getCfg('platform', DEFAULT_PLATFORM),
        notices: await getCfg('notices', [])
      }
    });
  }

  return json(res, 404, { error: 'Not found' });
}

/* ---------- static files ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function sendFile(req, res, file) {
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': (ext === '.html' || path.basename(file) === 'sw.js' || ext === '.webmanifest') ? 'no-cache' : 'public, max-age=3600' };
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && ['.html', '.js', '.css', '.json', '.svg'].includes(ext);
  if (gz) { headers['Content-Encoding'] = 'gzip'; headers['Vary'] = 'Accept-Encoding'; }
  res.writeHead(200, headers);
  const s = fs.createReadStream(file);
  s.on('error', () => res.destroy());
  (gz ? s.pipe(zlib.createGzip()) : s).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let pathname = url.pathname;
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);

    if (pathname === '/') pathname = '/index.html';
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
    const file = path.resolve(PUBLIC, '.' + path.normalize('/' + decoded));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(req, res, file);
    const index = path.join(PUBLIC, 'index.html');
    if (fs.existsSync(index)) return sendFile(req, res, index);
    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
  }
});

init()
  .then(() => server.listen(PORT, '0.0.0.0', () => console.log(`BusinessHub Kenya running on port ${PORT}`)))
  .catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => pool.end().finally(() => process.exit(0))));
}
