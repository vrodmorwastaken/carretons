'use strict';
const crypto = require('crypto');

const COOKIE = 'carretons_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 dies

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('Falta SESSION_SECRET (mínim 16 caràcters)');
  return s;
}

function mac(body) {
  return crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(body)}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/** Retorna { auth:true, role } o null. */
function getSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const p = verify(token);
  return p ? { auth: true, role: p.role } : null;
}

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;
}

function setSessionCookie(req, res, role) {
  const token = sign({ role, exp: Math.floor(Date.now() / 1000) + MAX_AGE });
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${isSecure(req) ? '; Secure' : ''}`);
}

function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Converteix un codi d'accés en rol, segons les variables d'entorn. */
function roleForCode(code) {
  const table = [
    ['admin', process.env.CODE_ADMIN],
    ['standard', process.env.CODE_STANDARD],
    ['speaker', process.env.CODE_SPEAKER],
  ];
  let found = null;
  for (const [role, expected] of table) {
    if (expected && safeEqual(code, expected) && !found) found = role;
  }
  return found;
}

module.exports = { getSession, setSessionCookie, clearSessionCookie, roleForCode };
