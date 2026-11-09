/**
 * MyBusinessHub — API + static app server
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

/* Optional email (recovery codes). Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (and SMTP_SECURE=true for port 465). Without it, the admin gives the code. */
const MAIL_ON = !!process.env.SMTP_HOST;
let _mailer = null;
async function sendMail(to, subject, text) {
  if (!MAIL_ON) return false;
  try {
    if (!_mailer) {
      const nm = require('nodemailer');
      _mailer = nm.createTransport({
        host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
      });
    }
    await _mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
    return true;
  } catch (e) { console.warn('mail failed:', e.message); return false; }
}

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT) || 3847;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

// Set BACKUP_DIR to a persistent volume path on Railway/Render, otherwise backups vanish on redeploy.
const BACKUP_ROOT = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(ROOT, 'data', 'businesshub');
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14); // newest files kept per business

function safeEmailDir(email) {
  return String(email || 'unknown').toLowerCase().replace(/[^a-z0-9@._+-]/g, '_').slice(0, 120);
}
function ensureBackupDir(email) {
  const dir = path.join(BACKUP_ROOT, safeEmailDir(email));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function writeBusinessBackupFile(email, business) {
  const dir = ensureBackupDir(email);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${String(business.name || 'business').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}_${stamp}.json`;
  const filePath = path.join(dir, name);
  const payload = {
    type: 'businesshub_business_backup',
    version: 3,
    folder: 'businesshub',
    email,
    exportedAt: new Date().toISOString(),
    business
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  try { // retention: keep only the newest BACKUP_KEEP files of this business
    const prefix = name.slice(0, name.length - stamp.length - 6);
    fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort().reverse()
      .slice(BACKUP_KEEP).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  } catch (e) { /* pruning is best-effort */ }
  return { filePath, name, dir, relative: path.join('businesshub', safeEmailDir(email), name) };
}
async function emailBackupOptional(to, subject, text, filename, jsonContent) {
  const key = process.env.RESEND_API_KEY || '';
  const from = process.env.BACKUP_FROM_EMAIL || 'BusinessHub <onboarding@resend.dev>';
  if (!key) return { sent: false, reason: 'RESEND_API_KEY not set — backup saved on server only' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        attachments: [{ filename, content: Buffer.from(jsonContent).toString('base64') }]
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, reason: data.message || ('HTTP ' + res.status) };
    return { sent: true, id: data.id };
  } catch (e) {
    return { sent: false, reason: String(e.message || e) };
  }
}


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
  FREE: { name: 'Free', price: 0, installFee: 1000, annual: 0, bizLimit: 1, workers: 1, products: 50, branches: 1, onlineStore: false, ai: false, label: 'Free · trial / limited' },
  STARTER: { name: 'Starter', price: 800, installFee: 1000, quarterly: 2200, annual: 8000, bizLimit: 1, workers: 3, products: 500, branches: 1, onlineStore: false, ai: false, label: 'Starter · KES 800/mo' },
  PRO: { name: 'Professional', price: 1500, installFee: 1000, quarterly: 4000, annual: 15000, bizLimit: 3, workers: 10, products: 5000, branches: 3, onlineStore: true, ai: true, label: 'Professional · KES 1,500/mo' },
  BUSINESS: { name: 'Business', price: 4500, installFee: 1000, quarterly: 12000, annual: 45000, bizLimit: 10, workers: 50, products: 50000, branches: 10, onlineStore: true, ai: true, label: 'Business · KES 4,500/mo' },
  ENTERPRISE: { name: 'Enterprise', price: 0, installFee: 1000, quarterly: 0, annual: 0, bizLimit: 99, workers: 999, products: 999999, branches: 99, onlineStore: true, ai: true, label: 'Enterprise · custom' }
};
function mergePlans(stored) {
  const base = JSON.parse(JSON.stringify(DEFAULT_PLANS));
  if (!stored || typeof stored !== 'object') return base;
  Object.keys(stored).forEach((k) => {
    base[k] = Object.assign({}, base[k] || {}, stored[k]);
  });
  return base;
}
const DEFAULT_PLATFORM = {
  company: 'MyBusinessHub', ownerName: '', phone: '', email: '', address: '', city: 'Nairobi',
  country: 'Kenya', mpesaTill: '', paybill: '', bankName: '', bankAccount: '', supportEmail: '', website: '', notes: ''
};
// Fields a business owner may never set themselves
const OWNER_LOCKED = ['id', 'ownerId', 'suspended', 'trialEndsAt', 'trialExtended', 'plan', 'planPaidAt', 'planReceipt', 'pendingPlan', 'createdAt'];
const PUBLIC_PRODUCT_FIELDS = ['id', 'name', 'sub', 'category', 'sourceCat', 'unit', 'packQty', 'packUnit', 'price', 'stock', 'image', 'sku', 'barcode'];
const publicProduct = (p) => { const o = {}; PUBLIC_PRODUCT_FIELDS.forEach((k) => { if (p[k] !== undefined) o[k] = p[k]; }); return o; };
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
const fails = new Map();
const lockedOut = (key, max) => { const e = fails.get(key); return !!e && e.reset > Date.now() && e.n >= max; };
function addFail(key, windowMs) {
  const now = Date.now(); const e = fails.get(key);
  if (!e || e.reset < now) fails.set(key, { n: 1, reset: now + windowMs }); else e.n++;
}
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const e = hits.get(key);
  if (!e || e.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return false; }
  e.n++;
  return e.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of hits) if (e.reset < now) hits.delete(k); for (const [k, e] of fails) if (e.reset < now) fails.delete(k); }, 60000).unref();
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
    // only FAILED attempts count; a victim's account can't be locked from other networks
    if (lockedOut('login-ip:' + ip, 30) || lockedOut('login-em:' + email + '|' + ip, 8)) {
      return json(res, 429, { error: 'Too many failed login attempts. Try again in 15 minutes.' });
    }
    const user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
    const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      addFail('login-ip:' + ip, 900000); addFail('login-em:' + email + '|' + ip, 900000);
      return json(res, 401, { error: 'Invalid email or password' });
    }
    fails.delete('login-em:' + email + '|' + ip);
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
      plans: mergePlans(await getCfg('plans', DEFAULT_PLANS)), platformUpdate: await getCfg('platformUpdate', null)
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
    const plans = mergePlans(await getCfg('plans', DEFAULT_PLANS));
    const planKey = mine[0]?.data?.plan || 'FREE';
    const limit = (plans[planKey] || DEFAULT_PLANS.FREE).bizLimit || 1;
    if (mine.length >= limit) return json(res, 403, { error: 'Plan business limit reached' });
    const b = emptyBiz(u.id, body);
    // keep the id the device already uses, so later syncs (PUT by id) find this business instead of making copies
    if (typeof body.id === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(body.id)) {
      const taken = (await pool.query('SELECT 1 FROM businesses WHERE id=$1', [body.id])).rowCount;
      if (!taken) b.id = body.id;
    }
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
      const out = await withBiz(id, async (b, c) => {
        let nb;
        if (!isAdmin(u)) {
          nb = { ...b, ...body };
          OWNER_LOCKED.forEach((k) => { nb[k] = b[k]; }); // server keeps control of these
          { // deleted products stay deleted, even if a stale device pushes them again
            const m = {};
            [...(Array.isArray(b.deletedProducts) ? b.deletedProducts : []), ...(Array.isArray(body.deletedProducts) ? body.deletedProducts : [])]
              .forEach((t) => { if (t && t.id) m[t.id] = t; });
            nb.deletedProducts = Object.values(m).slice(-5000);
            if (Array.isArray(nb.products) && nb.deletedProducts.length) {
              const gone = new Set(nb.deletedProducts.map((t) => t.id));
              nb.products = nb.products.filter((p) => !(p && gone.has(p.id)));
            }
          }
          if (Array.isArray(body.workers)) { // plan worker limit: existing workers stay, extra new ones are dropped
            const plans = mergePlans(await getCfg('plans', DEFAULT_PLANS, c));
            const pl = plans[b.plan || 'FREE'] || plans.FREE || {};
            const lim = typeof pl.workers === 'number' ? pl.workers : Infinity;
            const have = new Set((b.workers || []).map((w) => w && w.id));
            const keep = body.workers.filter((w) => w && have.has(w.id));
            const added = body.workers.filter((w) => w && !have.has(w.id));
            nb.workers = [...keep, ...added.slice(0, Math.max(0, lim - keep.length))];
          }
          if (Array.isArray(body.orders) && Array.isArray(b.orders)) {
            const known = new Set(body.orders.map((o) => o && o.id));
            const missing = b.orders.filter((o) => o && !known.has(o.id));
            if (missing.length) {
              nb.orders = [...body.orders, ...missing];
              const prods = Array.isArray(nb.products) ? nb.products : [];
              missing.forEach((o) => {
                if (o.status === 'CANCELLED') return;
                (o.items || []).forEach((it) => {
                  const p = prods.find((x) => x.id === it.product_id);
                  if (!p) return;
                  const lp = Number(it.listPrice);
                  const used = (lp > 0 ? Number(it.qty) * Number(it.price) / lp : Number(it.qty)) || 0;
                  p.stock = Math.max(0, Math.round(((Number(p.stock) || 0) - used) * 10000) / 10000);
                });
              });
              ['orderN', 'onlineN'].forEach((k) => { nb[k] = Math.max(Number(nb[k]) || 0, Number(b[k]) || 0); });
            }
          }
        } else {
          nb = { ...b };
          ['plan', 'suspended', 'trialEndsAt', 'trialExtended', 'name', 'salesPin', 'pinLocked', 'pinFails', 'pinLockedAt'].forEach((k) => { if (body[k] !== undefined) nb[k] = body[k]; });
          if (body.rejectPendingPlan) nb.pendingPlan = null;
          if (body.plan && body.plan !== 'FREE') {
            nb.planPaidAt = today();
            nb.planReceipt = (b.pendingPlan && b.pendingPlan.receipt) || b.planReceipt || 'ADMIN-' + Date.now();
            nb.pendingPlan = null;
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

  const planReq = pathname.match(/^\/api\/businesses\/([^/]+)\/plan-request$/);
  if (planReq && method === 'POST') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const plans = mergePlans(await getCfg('plans', DEFAULT_PLANS));
    const plan = String(body.plan || '');
    if (!plans[plan] || plan === 'FREE') return json(res, 400, { error: 'Unknown plan' });
    const out = await withBiz(planReq[1], async (b, c) => {
      if (!isAdmin(u) && b.ownerId !== u.id) return { status: 403, body: { error: 'Forbidden' } };
      b.pendingPlan = { plan, receipt: str(body.receipt, 60), phone: str(body.phone, 40), at: new Date().toISOString() };
      const alerts = await getCfg('adminAlerts', [], c);
      alerts.push({ id: uid(), type: 'plan_payment', businessId: b.id, businessName: b.name || '', ownerId: b.ownerId, at: b.pendingPlan.at,
        message: `Plan payment claimed: ${b.name || b.id} → ${plan}, receipt ${b.pendingPlan.receipt || 'n/a'}. Verify, then set the plan in Admin.` });
      await setCfg('adminAlerts', alerts.slice(-100), c);
      if (MAIL_ON) {
        pool.query("SELECT email FROM users WHERE role='admin' ORDER BY created_at LIMIT 1").then((r) => {
          const to = process.env.ADMIN_NOTIFY_EMAIL || (r.rows[0] && r.rows[0].email);
          if (to) sendMail(to, 'Plan payment to confirm: ' + (b.name || b.id), `${b.name || b.id} says they paid for the ${plan} plan.\nM-Pesa receipt: ${b.pendingPlan.receipt || 'n/a'}\nPhone: ${b.pendingPlan.phone || 'n/a'}\n\nCheck your till, then confirm in Admin > Dashboard.`).catch(() => {});
        }).catch(() => {});
      }
      return { save: b, status: 200, body: { ok: true, pendingPlan: b.pendingPlan } };
    });
    return json(res, out.status, out.body);
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
      planCounts, plans: mergePlans(await getCfg('plans', DEFAULT_PLANS)), platform: await getCfg('platform', DEFAULT_PLATFORM),
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
    if (limited('forgot:' + ip, 8, 3600000)) return json(res, 429, { error: 'Too many requests, try again later' });
    const body = await readBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    if (!email) return json(res, 400, { error: 'Email required' });
    const requestId = crypto.randomBytes(16).toString('hex'); // lets ONLY this browser receive the code once approved
    const generic = MAIL_ON
      ? { ok: true, emailed: true, requestId, message: 'If that email has an account, a 6-digit recovery code has been sent to it (valid 30 min). Check your spam folder too.' }
      : { ok: true, waiting: true, requestId, message: 'Request sent to the platform admin. As soon as they approve it, your recovery code appears on this page automatically (valid 30 min). Keep this page open.' };
    const u = (await pool.query('SELECT id, email, name, role FROM users WHERE email=$1 AND role<>\'admin\'', [email])).rows[0];
    if (!u) return json(res, 200, generic);
    const tokens = await getCfg('resetTokens', {});
    Object.keys(tokens).forEach((k) => { if (!tokens[k] || tokens[k].expires < Date.now()) delete tokens[k]; });
    let t = tokens[email];
    let code;
    if (t && t.userId === u.id && t.plain) {
      // a code is already active: keep it (a second click must NOT replace the code the admin approved / was emailed)
      code = t.plain;
      t.reqs = [...(t.reqs || []), sha(requestId)].slice(-10);
    } else {
      code = String(crypto.randomInt(100000, 1000000));
      t = { codeHash: sha(code), plain: code, userId: u.id, expires: Date.now() + 30 * 60 * 1000, tries: 0, approved: MAIL_ON ? false : false, reqs: [sha(requestId)] };
      tokens[email] = t;
    }
    await setCfg('resetTokens', tokens);
    let alerts = await getCfg('adminAlerts', []);
    alerts = alerts.filter((x) => !(x.type === 'password_reset_request' && x.email === email));
    alerts.push({ id: uid(), type: 'password_reset_request', email, userId: u.id, name: u.name || '', at: new Date().toISOString(), message: 'Password recovery requested by ' + email + '. Press Approve to send the code straight to their recovery page (valid 30 min). Only approve if you trust the request.' });
    await setCfg('adminAlerts', alerts.slice(-100));
    if (MAIL_ON) sendMail(email, 'Your BusinessHub recovery code', 'Your BusinessHub password recovery code is ' + code + '.\nIt is valid for 30 minutes. If you did not ask for this, ignore this email.').catch(() => {});
    return json(res, 200, generic);
  }

  // The recovery page asks this every few seconds; the code is released only to the browser that made the request, and only after approval
  if (pathname === '/api/auth/forgot/status' && method === 'POST') {
    if (limited('fstat:' + ip, 400, 3600000)) return json(res, 429, { error: 'Too many requests' });
    const body = await readBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const requestId = String(body.requestId || '');
    const tokens = await getCfg('resetTokens', {});
    const t = tokens[email];
    if (t && Date.now() < (t.expires || 0) && t.approved && t.plain && requestId && (t.reqs || []).includes(sha(requestId))) {
      return json(res, 200, { ready: true, code: t.plain, expiresAt: t.expires });
    }
    return json(res, 200, { ready: false });
  }

  if (pathname === '/api/admin/recovery/approve' && method === 'POST') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const tokens = await getCfg('resetTokens', {});
    const t = tokens[email];
    if (!t || Date.now() > (t.expires || 0)) return json(res, 404, { error: 'That request has expired. Ask the client to request a new code.' });
    t.approved = true;
    await setCfg('resetTokens', tokens);
    const alerts = (await getCfg('adminAlerts', [])).filter((x) => !(x.type === 'password_reset_request' && x.email === email));
    await setCfg('adminAlerts', alerts);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/reset' && method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const code = String(body.code || '').trim();
    const password = String(body.password || '');
    if (limited('reset:' + ip, 10, 900000)) return json(res, 429, { error: 'Too many attempts, try again later' });
    if (!email || !code || password.length < MIN_PASSWORD || password.length > 200) return json(res, 400, { error: `Email, recovery code and new password (min ${MIN_PASSWORD} characters) required` });
    const tokens = await getCfg('resetTokens', {});
    const t = tokens[email];
    if (!t || Date.now() > (t.expires || 0)) return json(res, 400, { error: 'Invalid or expired recovery code' });
    if (t.codeHash !== sha(code)) {
      t.tries = (t.tries || 0) + 1;
      if (t.tries >= 5) delete tokens[email];
      await setCfg('resetTokens', tokens);
      return json(res, 400, { error: 'Invalid or expired recovery code' });
    }
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [t.userId, await hashPassword(password)]);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [t.userId]);
    delete tokens[email];
    await setCfg('resetTokens', tokens);
    return json(res, 200, { ok: true, message: 'Password updated' });
  }

  if (pathname === '/api/admin/audit' && method === 'GET') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    return json(res, 200, { logs: await getCfg('auditLogs', []) });
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


  if (pathname === '/api/support/tickets' && method === 'GET') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const all = await getCfg('supportTickets', []);
    if (isAdmin(u)) return json(res, 200, { tickets: all });
    return json(res, 200, { tickets: all.filter((t) => t.userId === u.id || t.ownerId === u.id) });
  }

  if (pathname === '/api/support/tickets' && method === 'POST') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const all = await getCfg('supportTickets', []);
    const ticket = {
      id: uid(),
      userId: u.id,
      ownerId: u.id,
      email: u.email,
      businessId: body.businessId || null,
      subject: str(body.subject, 200) || 'Support request',
      body: str(body.body, 5000) || '',
      status: 'open',
      priority: body.priority || 'normal',
      createdAt: new Date().toISOString(),
      messages: [{ at: new Date().toISOString(), from: u.email, body: str(body.body, 5000) || '' }]
    };
    all.push(ticket);
    await setCfg('supportTickets', all.slice(-200));
    const alerts = await getCfg('adminAlerts', []);
    alerts.push({ id: uid(), type: 'support_ticket', ticketId: ticket.id, at: ticket.createdAt, message: 'Support ticket: ' + ticket.subject, email: u.email });
    await setCfg('adminAlerts', alerts.slice(-100));
    return json(res, 201, { ticket });
  }

  if (pathname === '/api/support/tickets/reply' && method === 'POST') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const body = await readBody(req);
    const all = await getCfg('supportTickets', []);
    const t = all.find((x) => x.id === body.ticketId);
    if (!t) return json(res, 404, { error: 'Ticket not found' });
    if (!isAdmin(u) && t.userId !== u.id) return json(res, 403, { error: 'Forbidden' });
    t.messages = t.messages || [];
    t.messages.push({ at: new Date().toISOString(), from: u.email, body: str(body.body, 5000), admin: isAdmin(u) });
    if (body.status && isAdmin(u)) t.status = body.status;
    if (isAdmin(u) && body.status === 'resolved') t.resolvedAt = new Date().toISOString();
    await setCfg('supportTickets', all);
    return json(res, 200, { ticket: t });
  }

  if (pathname === '/api/admin/platform-stats' && method === 'GET') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const clients = (await pool.query("SELECT * FROM users WHERE role<>'admin'")).rows;
    const bizs = (await pool.query('SELECT * FROM businesses')).rows.map(bizOut);
    const plans = mergePlans(await getCfg('plans', DEFAULT_PLANS));
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    let mrr = 0;
    bizs.forEach((b) => {
      const p = plans[b.plan] || plans.FREE;
      if (!b.suspended && b.plan && b.plan !== 'FREE') mrr += Number(p.price || 0);
    });
    const catCount = {};
    bizs.forEach((b) => {
      (b.categories || []).forEach((c) => { catCount[c] = (catCount[c] || 0) + 1; });
      if (b.categoryLabel) catCount[b.categoryLabel] = (catCount[b.categoryLabel] || 0) + 1;
    });
    return json(res, 200, {
      totals: {
        clients: clients.length,
        businesses: bizs.length,
        active: bizs.filter((b) => !b.suspended).length,
        suspended: bizs.filter((b) => b.suspended).length,
        trial: bizs.filter((b) => (b.plan || 'FREE') === 'FREE').length,
        paid: bizs.filter((b) => b.plan && b.plan !== 'FREE').length,
        workers: bizs.reduce((n, b) => n + ((b.workers || []).length), 0),
        products: bizs.reduce((n, b) => n + ((b.products || []).length), 0),
        mrr,
        arr: mrr * 12,
        newToday: bizs.filter((b) => (b.createdAt || '').slice(0, 10) === today).length,
        newMonth: bizs.filter((b) => (b.createdAt || '').slice(0, 7) === month).length
      },
      planCounts: Object.keys(plans).reduce((o, k) => {
        o[k] = bizs.filter((b) => (b.plan || 'FREE') === k).length;
        return o;
      }, {}),
      categories: catCount,
      plans
    });
  }

  if (pathname === '/api/admin/plans' && method === 'PUT') {
    const u = await authUser(req);
    if (!isAdmin(u)) return json(res, 403, { error: 'Admin only' });
    const body = await readBody(req);
    if (body.plans && typeof body.plans === 'object' && !Array.isArray(body.plans)) await setCfg('plans', body.plans);
    return json(res, 200, { plans: mergePlans(await getCfg('plans', DEFAULT_PLANS)) });
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
        products: (b.products || []).filter((p) => p.active !== false && (p.stock || 0) > 0).map(publicProduct),
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
        lines.push({ name: str(p.name), qty, price, product_id: p.id, unit: p.unit || 'pc', p });
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
        receipt: str(body.receipt || 'PENDING-PAY', 60), source: 'online',
        // same shape the owner's "Online orders" screen uses for orders placed from the shop page
        method: str(body.payMethod || 'mpesa', 30), orderStatus: 'NEW', paymentStatus: 'PENDING',
        deliveryFee: body.fulfillment === 'delivery' ? (Number(b.deliveryFee) || 0) : 0
      };
      b.orders = [...(b.orders || []), order];
      return { save: b, status: 201, body: { order } };
    });
    return json(res, out.status, out.body);
  }


  if (pathname.match(/^\/api\/businesses\/[^/]+\/backup$/) && method === 'POST') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const id = pathname.split('/')[3];
    const row = (await pool.query('SELECT * FROM businesses WHERE id=$1', [id])).rows[0];
    if (!row) return json(res, 404, { error: 'Not found' });
    if (!isAdmin(u) && row.owner_id !== u.id) return json(res, 403, { error: 'Forbidden' });
    const body = await readBody(req);
    const b = bizOut(row);
    const email = String((isAdmin(u) && body.email) || u.email || '').toLowerCase().trim();
    if (!email) return json(res, 400, { error: 'Email required for backup folder' });
    const written = writeBusinessBackupFile(email, b);
      b.lastAutoBackupAt = new Date().toISOString();
      await pool.query('UPDATE businesses SET data=$2::jsonb WHERE id=$1', [id, JSON.stringify(b)]);
    let mail = { sent: false, reason: 'not requested' };
    if (body.sendEmail) {
      const raw = fs.readFileSync(written.filePath, 'utf8');
      mail = await emailBackupOptional(
        email,
        'BusinessHub backup — ' + (b.name || id),
        'Your business backup is attached and also stored under BusinessHub cloud folder for ' + email + '.\nFile: ' + written.name,
        written.name,
        raw
      );
    }
    return json(res, 200, {
      ok: true,
      folder: 'businesshub/' + safeEmailDir(email),
      file: written.name,
      relative: written.relative,
      email,
      mail
    });
  }

  if (pathname === '/api/backups/mine' && method === 'GET') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'Unauthorized' });
    const email = u.email;
    const dir = path.join(BACKUP_ROOT, safeEmailDir(email));
    let files = [];
    try {
      if (fs.existsSync(dir)) {
        files = fs.readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => {
            const st = fs.statSync(path.join(dir, f));
            return { name: f, size: st.size, at: st.mtime.toISOString(), folder: 'businesshub/' + safeEmailDir(email) };
          })
          .sort((a, b) => (a.at < b.at ? 1 : -1));
      }
    } catch (e) {}
    return json(res, 200, { email, folder: 'businesshub/' + safeEmailDir(email), files });
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
        users, businesses, plans: mergePlans(await getCfg('plans', DEFAULT_PLANS)), platform: await getCfg('platform', DEFAULT_PLATFORM),
        notices: await getCfg('notices', [])
      }
    });
  }

  return json(res, 404, { error: 'Not found' });
}

/* ---------- static files ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
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
    if (!path.extname(decoded) && fs.existsSync(index)) return sendFile(req, res, index); // SPA routes only
    if (path.extname(decoded)) { res.writeHead(404); return res.end('Not found'); }
    if (fs.existsSync(index)) return sendFile(req, res, index);
    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
  }
});


/** Auto-backup every 2 days (checks every 6 hours). Saves under data/businesshub/<email>/ */
const AUTO_BACKUP_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;
async function runScheduledBusinessBackups() {
  try {
    const rows = (await pool.query('SELECT id, owner_id, data FROM businesses')).rows;
    const users = (await pool.query('SELECT id, email FROM users')).rows;
    const byId = Object.fromEntries(users.map(u => [u.id, u.email]));
    const now = Date.now();
    let n = 0;
    for (const row of rows) {
      let b = row.data;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch { continue; } }
      if (!b || typeof b !== 'object') continue;
      if (b.autoBackup === false) continue;
      b.id = b.id || row.id;
      const last = b.lastAutoBackupAt ? Date.parse(b.lastAutoBackupAt) : 0;
      if (last && !Number.isNaN(last) && (now - last) < AUTO_BACKUP_INTERVAL_MS) continue;
      const email = byId[row.owner_id] || b.ownerEmail || '';
      if (!email) continue;
      try {
        writeBusinessBackupFile(email, b);
        b.lastAutoBackupAt = new Date().toISOString();
        await pool.query('UPDATE businesses SET data=$2::jsonb WHERE id=$1', [row.id, JSON.stringify(b)]);
        n++;
      } catch (e) {
        console.warn('[auto-backup] fail', row.id, e.message);
      }
    }
    // Admin/platform snapshot every 2 days
    try {
      const cfg = await getCfg('last_admin_auto_backup', null);
      const lastAd = cfg ? Date.parse(cfg) : 0;
      if (!lastAd || (now - lastAd) >= AUTO_BACKUP_INTERVAL_MS) {
        const dir = ensureBackupDir('_platform');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const businesses = (await pool.query('SELECT * FROM businesses ORDER BY created_at')).rows;
        const payload = {
          type: 'businesshub_admin_backup',
          version: 3,
          exportedAt: new Date().toISOString(),
          auto: true,
          data: {
            users: (await pool.query('SELECT id,email,name,role,created_at FROM users')).rows,
            businesses: businesses.map(r => {
              let d = r.data; if (typeof d === 'string') try { d = JSON.parse(d); } catch { d = {}; }
              return d;
            })
          }
        };
        fs.writeFileSync(path.join(dir, 'platform_auto_' + stamp + '.json'), JSON.stringify(payload, null, 2));
        fs.readdirSync(dir).filter((f) => f.startsWith('platform_auto_')).sort().reverse().slice(BACKUP_KEEP).forEach((f) => fs.unlinkSync(path.join(dir, f)));
        await setCfg('last_admin_auto_backup', new Date().toISOString());
        console.log('[auto-backup] platform snapshot saved');
      }
    } catch (e) {
      console.warn('[auto-backup] platform', e.message);
    }
    if (n) console.log('[auto-backup] businesses saved:', n);
  } catch (e) {
    console.warn('[auto-backup]', e.message);
  }
}
function startAutoBackupScheduler() {
  setTimeout(() => { runScheduledBusinessBackups().catch(() => {}); }, 20000);
  setInterval(() => { runScheduledBusinessBackups().catch(() => {}); }, 6 * 60 * 60 * 1000);
}

init()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => console.log(`MyBusinessHub running on port ${PORT}`));
    startAutoBackupScheduler();
    console.log('[auto-backup] scheduler started (every 2 days)');
  })
  .catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => pool.end().finally(() => process.exit(0))));
}
