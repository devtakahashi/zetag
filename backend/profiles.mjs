const tags = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const presets = new Set(['zelle','paypal','solana','pump-fun','coingecko','dex-screener','zetag-space-courier','zetag-after-hours']);
const encode = new TextEncoder();
const json = (body, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

function walletKey(address) {
  if (typeof address !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  let value = 0n;
  for (const letter of address) value = value * 58n + BigInt(base58.indexOf(letter));
  const bytes = [];
  while (value) { bytes.unshift(Number(value & 255n)); value >>= 8n; }
  const leading = address.match(/^1*/)[0].length;
  if (bytes.length + leading !== 32) return null;
  return Uint8Array.from([...Array(leading).fill(0), ...bytes]);
}

function validAvatar(avatar) {
  return typeof avatar === 'string' && (avatar === '' || presets.has(avatar) ||
    (avatar.length <= 8000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)));
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let total = 0;
  let raw = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 10240) { await reader.cancel(); return null; }
    raw += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(raw + decoder.decode()); } catch { return null; }
}

const sessionSeconds = 60 * 60 * 24 * 7;
const cookieName = '__Secure-zetag-profile';
const select = `SELECT p.tag, p.wallet, p.avatar, p.joined_at, COALESCE(b.bio, '') AS bio
  FROM profiles p LEFT JOIN profile_bios b ON p.wallet = b.wallet WHERE `;

function profileData(row) {
  return { tag: row.tag, avatar: row.avatar, bio: row.bio, joinedAt: row.joined_at };
}

async function digest(value) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(value)));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function tokenHash(request) {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Secure-zetag-profile=([0-9a-f]{64})(?:;|$)/)?.[1];
  return token ? digest(token) : null;
}

function cookie(token, seconds) {
  return cookieName + '=' + token + '; Path=/pay/_profiles; Max-Age=' + seconds + '; Secure; HttpOnly; SameSite=Strict';
}

async function sessionWallet(request, db) {
  const hash = await tokenHash(request);
  if (!hash) return null;
  const row = await db.prepare('SELECT wallet FROM profile_sessions WHERE token_hash = ? AND expires >= ?')
    .bind(hash, Date.now()).first();
  return row?.wallet ?? null;
}

async function ownerResponse(db, wallet, request) {
  const current = await db.prepare(select + 'p.wallet = ?').bind(wallet).first();
  const previous = await tokenHash(request);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  await db.batch([
    db.prepare('DELETE FROM profile_sessions WHERE expires < ? OR token_hash = ?').bind(Date.now(), previous),
    db.prepare('INSERT INTO profile_sessions (token_hash, wallet, expires) VALUES (?, ?, ?)')
      .bind(await digest(token), wallet, Date.now() + sessionSeconds * 1000)
  ]);
  const response = json({ wallet, profile: current ? profileData(current) : null });
  response.headers.set('Set-Cookie', cookie(token, sessionSeconds));
  return response;
}

async function createChallenge(db, url, input, login) {
  const { wallet, tag = '', avatar = '', bio = '' } = input ?? {};
  if (!walletKey(wallet) || (!login && (typeof tag !== 'string' || !tags.test(tag) ||
      !validAvatar(avatar) || typeof bio !== 'string' || bio.length > 120))) {
    return json({ error: 'Check your wallet, tag, and profile details.' }, 400);
  }
  const nonce = crypto.randomUUID();
  const expires = Date.now() + 300000;
  const details = login ? '' : JSON.stringify({ avatar, bio });
  const message = [
    login ? 'Sign in to ZeTag' : 'Save your ZeTag profile', 'Site: ' + url.origin, 'Wallet: ' + wallet,
    ...(login ? [] : ['Tag: @' + tag, 'Profile hash: ' + await digest(details)]),
    'Nonce: ' + nonce, 'Expires: ' + new Date(expires).toISOString(), 'This message does not authorize any transfer.'
  ].join('\n');
  await db.batch([
    db.prepare('DELETE FROM profile_challenges WHERE expires < ?').bind(Date.now()),
    db.prepare('INSERT INTO profile_challenges (nonce, wallet, tag, avatar, message, expires) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(nonce, wallet, login ? '' : tag, details, message, expires)
  ]);
  return json({ nonce, message });
}

async function useChallenge(db, input) {
  const { nonce, signature } = input ?? {};
  if (typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(nonce) ||
      typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return null;
  const challenge = await db.prepare('SELECT * FROM profile_challenges WHERE nonce = ? AND expires >= ?')
    .bind(nonce, Date.now()).first();
  if (!challenge) return null;
  const key = await crypto.subtle.importKey('raw', walletKey(challenge.wallet), 'Ed25519', false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', key, Uint8Array.from(atob(signature), c => c.charCodeAt(0)), encode.encode(challenge.message))) {
    return null;
  }
  return await db.prepare('DELETE FROM profile_challenges WHERE nonce = ? AND expires >= ? RETURNING *')
    .bind(nonce, Date.now()).first();
}

async function ping(request, db, path, input) {
  const wallet = await sessionWallet(request, db);
  if (!wallet) return json({ error: 'Sign in with your wallet to use Ping.' }, 401);
  const owner = await db.prepare('SELECT tag FROM profiles WHERE wallet = ?').bind(wallet).first();
  if (!owner) return json({ error: 'Claim a ZeTag to use Ping.' }, 403);
  if (path === '/_ping' && request.method === 'GET') {
    const rows = await db.prepare(`
      SELECT p.tag, MAX(m.id) AS latest
      FROM ping_messages m JOIN profiles p
        ON p.wallet = CASE WHEN m.sender = ? THEN m.recipient ELSE m.sender END
      WHERE m.sender = ? OR m.recipient = ?
      GROUP BY p.tag ORDER BY latest DESC LIMIT 30
    `).bind(wallet, wallet, wallet).all();
    return json({ contacts: rows.results.map(row => row.tag) });
  }
  const tag = path.slice('/_ping/'.length);
  if (!tags.test(tag)) return json({ error: 'Invalid recipient tag.' }, 400);
  const peer = await db.prepare('SELECT wallet FROM profiles WHERE tag = ?').bind(tag).first();
  if (!peer || peer.wallet === wallet) return json({ error: 'Choose another ZeTag.' }, 404);
  if (request.method === 'GET') {
    const rows = await db.prepare(`
      SELECT id, sender, body, sent_at FROM ping_messages
      WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
      ORDER BY id DESC LIMIT 50
    `).bind(wallet, peer.wallet, peer.wallet, wallet).all();
    return json({ messages: rows.results.reverse().map(row => ({
      id: row.id, mine: row.sender === wallet, body: row.body, sentAt: row.sent_at
    })) });
  }
  const body = input?.body?.trim?.();
  if (typeof body !== 'string' || !body || body.length > 1000) return json({ error: 'Enter a message up to 1,000 characters.' }, 400);
  await db.prepare('INSERT INTO ping_messages (sender, recipient, body, sent_at) VALUES (?, ?, ?, ?)')
    .bind(wallet, peer.wallet, body, new Date().toISOString()).run();
  return json({ sent: true }, 201);
}

export async function profiles(request, db, url) {
  const path = url.pathname.slice('/pay/_profiles'.length);
  if (request.method === 'GET') {
    if (path === '/_me') {
      const wallet = await sessionWallet(request, db);
      if (!wallet) return json({ error: 'Wallet sign-in required.' }, 401);
      const row = await db.prepare(select + 'p.wallet = ?').bind(wallet).first();
      return json({ wallet, profile: row ? profileData(row) : null });
    }
    if (path === '/_ping' || path.startsWith('/_ping/')) return ping(request, db, path);
    const tag = path.slice(1);
    if (!path.startsWith('/') || !tags.test(tag)) return json({ error: 'Profile not found.' }, 404);
    const row = await db.prepare(select + `p.tag = ? OR p.wallet = (
      SELECT wallet FROM profile_tag_aliases WHERE tag = ?
    )`).bind(tag, tag).first();
    return row ? json(profileData(row)) : json({ error: 'Profile not found.' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')) {
    return json({ error: 'Use the ZeTag website to access this feature.' }, 403);
  }
  if (path === '/logout') {
    const hash = await tokenHash(request);
    if (hash) await db.prepare('DELETE FROM profile_sessions WHERE token_hash = ?').bind(hash).run();
    const response = json({ signedOut: true });
    response.headers.set('Set-Cookie', cookie('', 0));
    return response;
  }
  const input = await readBody(request);
  if (path === '/challenge' || path === '/login/challenge') return createChallenge(db, url, input, path === '/login/challenge');
  if (path.startsWith('/_ping/')) return ping(request, db, path, input);
  if (path !== '' && path !== '/login') return json({ error: 'Route not found.' }, 404);
  const challenge = await useChallenge(db, input);
  if (!challenge || (path === '/login') !== !challenge.tag) {
    return json({ error: 'The signature is invalid, expired, or already used.' }, 403);
  }
  if (path === '/login') return ownerResponse(db, challenge.wallet, request);
  let details;
  try { details = JSON.parse(challenge.avatar); } catch { return json({ error: 'Start a new profile edit.' }, 409); }
  if (!validAvatar(details?.avatar) || typeof details?.bio !== 'string') return json({ error: 'Start a new profile edit.' }, 409);
  const result = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO profile_tag_aliases (tag, wallet)
      SELECT tag, wallet FROM profiles WHERE wallet = ?
    `).bind(challenge.wallet),
    db.prepare(`
      INSERT INTO profiles (tag, wallet, avatar, joined_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM profile_tag_aliases WHERE tag = ? AND wallet <> ?
      )
      ON CONFLICT(wallet) DO UPDATE SET tag = excluded.tag, avatar = excluded.avatar
      WHERE NOT EXISTS (SELECT 1 FROM profiles other WHERE other.tag = excluded.tag AND other.wallet <> excluded.wallet)
      ON CONFLICT(tag) DO NOTHING
      RETURNING wallet
    `).bind(challenge.tag, challenge.wallet, details.avatar, new Date().toISOString(), challenge.tag, challenge.wallet),
    db.prepare(`
      INSERT INTO profile_bios (wallet, bio)
      SELECT wallet, ? FROM profiles WHERE wallet = ? AND tag = ?
      ON CONFLICT(wallet) DO UPDATE SET bio = excluded.bio
    `).bind(details.bio, challenge.wallet, challenge.tag)
  ]);
  if (!result[1].results.length) return json({ error: 'That tag is already taken.' }, 409);
  return ownerResponse(db, challenge.wallet, request);
}
