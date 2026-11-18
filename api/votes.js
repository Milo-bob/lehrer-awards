// Stimmen-API für die Lehrer Awards (Vercel Serverless Function, keine Abhängigkeiten).
//   GET    /api/votes?t=<geraete-token>        -> { tally: {kategorie:{lehrer:anzahl}}, mine: {kategorie:lehrer} }
//   POST   /api/votes  { t, cat, tid }          -> Stimme setzen oder ändern
//   DELETE /api/votes  { t, cat }               -> Stimme zurückziehen
// Datenbank: Upstash Redis per REST (Umgebungsvariablen KV_REST_API_URL/_TOKEN oder UPSTASH_REDIS_REST_URL/_TOKEN).
// Gespeichert wird nur: Zähler pro Kategorie/Lehrkraft und pro Geräte-Token die gewählte Lehrkraft. Keine IPs im Klartext.
const crypto = require('crypto');
const { CATS, TEACHERS } = require('./_data');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const TOKEN_RE = /^[A-Za-z0-9-]{16,64}$/;
const HOURLY_LIMIT = 300; // pro IP und Stunde (Schule = oft eine gemeinsame IP, daher großzügig)

async function redis(commands) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('redis ' + r.status);
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error('redis: ' + x.error);
    return x.result;
  });
}
const toObj = (flat) => {
  const o = {};
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) o[flat[i]] = Math.max(0, Number(flat[i + 1]) || 0);
  return o;
};
const toStrObj = (flat) => {
  const o = {};
  for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) o[flat[i]] = String(flat[i + 1]);
  return o;
};
const tKey = (cat) => 'la:tally:' + cat;
const dKey = (tok) => 'la:dev:' + tok;

async function snapshot(token) {
  const cmds = CATS.map((c) => ['HGETALL', tKey(c)]);
  if (token) cmds.push(['HGETALL', dKey(token)]);
  const res = await redis(cmds);
  const tally = {};
  CATS.forEach((c, i) => {
    const t = toObj(res[i]);
    Object.keys(t).forEach((id) => { if (!TEACHERS.includes(id)) delete t[id]; });
    tally[c] = t;
  });
  const mine = token ? toStrObj(res[CATS.length]) : {};
  return { tally, mine };
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (!URL_ || !TOKEN) return send(res, 503, { error: 'no-db' });
  try {
    if (req.method === 'GET') {
      const t = String((req.query && req.query.t) || '');
      return send(res, 200, await snapshot(TOKEN_RE.test(t) ? t : null));
    }
    if (req.method !== 'POST' && req.method !== 'DELETE') return send(res, 405, { error: 'method' });

    const { t, cat, tid } = readBody(req);
    if (!TOKEN_RE.test(String(t))) return send(res, 400, { error: 'token' });
    if (!CATS.includes(cat)) return send(res, 400, { error: 'category' });
    if (req.method === 'POST' && !TEACHERS.includes(tid)) return send(res, 400, { error: 'teacher' });

    // Schutz vor Skripten: Anzahl Änderungen pro IP (nur als Hash) und Stunde begrenzen
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const iph = crypto.createHash('sha256').update('la|' + ip).digest('hex').slice(0, 16);
    const rlKey = 'la:rl:' + iph + ':' + Math.floor(Date.now() / 3600000);
    const [count] = await redis([['INCR', rlKey], ['EXPIRE', rlKey, 4000]]);
    if (count > HOURLY_LIMIT) return send(res, 429, { error: 'rate' });

    const [prev] = await redis([['HGET', dKey(t), cat]]);
    const cmds = [];
    if (req.method === 'POST') {
      if (prev === tid) return send(res, 200, await snapshot(t));
      if (prev && TEACHERS.includes(prev)) cmds.push(['HINCRBY', tKey(cat), prev, -1]);
      cmds.push(['HINCRBY', tKey(cat), tid, 1], ['HSET', dKey(t), cat, tid]);
    } else {
      if (!prev) return send(res, 200, await snapshot(t));
      cmds.push(['HINCRBY', tKey(cat), prev, -1], ['HDEL', dKey(t), cat]);
    }
    cmds.push(['EXPIRE', dKey(t), 60 * 60 * 24 * 365]);
    await redis(cmds);
    return send(res, 200, await snapshot(t));
  } catch (e) {
    return send(res, 500, { error: 'server' });
  }
};
