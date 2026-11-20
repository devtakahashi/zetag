import { solanaRpc } from './solana-rpc.mjs';
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
  let selectedAvatar = avatar;
  if (!login && !selectedAvatar) {
    const existing = await db.prepare('SELECT avatar FROM profiles WHERE wallet = ?').bind(wallet).first();
    const choices = [...presets];
    selectedAvatar = existing?.avatar || choices[crypto.getRandomValues(new Uint32Array(1))[0] % choices.length];
  }
  const details = login ? '' : JSON.stringify({ avatar: selectedAvatar, bio });
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
  const expected = request.headers.get('X-ZeTag-Wallet');
  if (!wallet || (expected && wallet !== expected)) {
    return json({ error: 'Sign in with your wallet to use Ping.' }, 401);
  }
  const owner = await db.prepare('SELECT tag, avatar FROM profiles WHERE wallet = ?').bind(wallet).first();
  if (!owner) return json({ error: 'Claim a ZeTag to use Ping.' }, 403);
  if (path === '/_ping' && request.method === 'GET') {
    const rows = await db.prepare(`
      WITH threads AS (
        SELECT CASE WHEN sender = ?1 THEN recipient ELSE sender END AS peer, MAX(id) AS latest
        FROM ping_messages WHERE sender = ?1 OR recipient = ?1 GROUP BY peer
      )
      SELECT p.tag, p.avatar, m.body AS preview, m.sent_at AS sentAt,
        (SELECT COUNT(*) FROM ping_messages
         WHERE recipient = ?1 AND sender = threads.peer AND id > COALESCE(r.last_id, 0)) AS unread
      FROM threads JOIN profiles p ON p.wallet = threads.peer JOIN ping_messages m ON m.id = threads.latest
      LEFT JOIN ping_read_positions r ON r.reader = ?1 AND r.peer = threads.peer
      ORDER BY threads.latest DESC LIMIT 50
    `).bind(wallet).all();
    const count = await db.prepare(`
      SELECT COUNT(*) AS unread FROM ping_messages m
      LEFT JOIN ping_read_positions r ON r.reader = m.recipient AND r.peer = m.sender
      WHERE m.recipient = ? AND m.id > COALESCE(r.last_id, 0)
    `).bind(wallet).first();
    return json({ contacts: rows.results.map(row => row.tag), threads: rows.results, unread: count.unread });
  }
  const [, , tag, action = '', extra] = path.split('/');
  if (extra !== undefined || !tags.test(tag) || (action && action !== 'read')) {
    return json({ error: 'Invalid recipient tag.' }, 400);
  }
  const peer = await db.prepare(`
    SELECT wallet, tag, avatar FROM profiles WHERE tag = ?1 OR wallet = (
      SELECT wallet FROM profile_tag_aliases WHERE tag = ?1
    )
  `).bind(tag).first();
  if (!peer || peer.wallet === wallet) return json({ error: 'Choose another ZeTag.' }, 404);
  if (request.method === 'GET' && !action) {
    const rows = await db.prepare(`
      SELECT id, sender, body, sent_at,
        id <= COALESCE((SELECT last_id FROM ping_read_positions WHERE reader = ?2 AND peer = ?1), 0) AS seen
      FROM ping_messages
      WHERE (sender = ?1 AND recipient = ?2) OR (sender = ?2 AND recipient = ?1)
      ORDER BY id DESC LIMIT 50
    `).bind(wallet, peer.wallet).all();
    return json({ owner, peer: { tag: peer.tag, avatar: peer.avatar }, messages: rows.results.reverse().map(row => ({
      id: row.id, mine: row.sender === wallet, body: row.body, sentAt: row.sent_at,
      read: row.sender === wallet && Boolean(row.seen)
    })) });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (action === 'read') {
    const through = input?.through;
    if (!Number.isSafeInteger(through) || through <= 0) return json({ error: 'Invalid message.' }, 400);
    await db.prepare(`
      INSERT INTO ping_read_positions (reader, peer, last_id)
      SELECT recipient, sender, id FROM ping_messages WHERE recipient = ? AND sender = ? AND id = ?
      ON CONFLICT(reader, peer) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)
    `).bind(wallet, peer.wallet, through).run();
    return json({ acknowledged: true });
  }
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  if (!body || body.length > 1000) return json({ error: 'Enter a message up to 1,000 characters.' }, 400);
  await db.prepare('INSERT INTO ping_messages (sender, recipient, body, sent_at) VALUES (?, ?, ?, ?)')
    .bind(wallet, peer.wallet, body, new Date().toISOString()).run();
  return json({ sent: true }, 201);
}

async function search(db, url) {
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9][a-z0-9_-]{1,23}$/.test(query)) return json({ matches: [] });
  const rows = await db.prepare(`
    SELECT tag, avatar FROM profiles
    WHERE tag = ?1 OR substr(tag, 1, length(?1)) = ?1 OR (length(?1) >= 3 AND instr(tag, ?1) > 0)
    ORDER BY CASE WHEN tag = ?1 THEN 0 WHEN substr(tag, 1, length(?1)) = ?1 THEN 1 ELSE 2 END,
      length(tag), tag
    LIMIT 6
  `).bind(query).all();
  return json({ matches: rows.results });
}

async function tokenBalance(request, db, rpcUrl, url) {
  const asset = url.searchParams.get('asset') || 'USDC';
  if (!['USDC','SOL'].includes(asset)) return json({ error: 'Unsupported token.' }, 400);
  const owner = await sessionWallet(request, db);
  if (!owner || owner !== request.headers.get('X-ZeTag-Wallet')) {
    return json({ error: 'Wallet sign-in required.' }, 401);
  }
  try {
    const value = await solanaRpc({SOLANA_RPC_URL:rpcUrl}, asset === 'SOL' ? 'getBalance' : 'getTokenAccountsByOwner',
      asset === 'SOL' ? [owner, {commitment:'confirmed'}] : [owner, {mint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'}, {encoding:'jsonParsed',commitment:'confirmed'}]);
    const result = {result:value};
    if (asset === 'SOL') {
      const amount = result.result?.value;
      if (result.error || !Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid SOL balance');
      return json({ amount: String(amount) });
    }
    if (result.error || !Array.isArray(result.result?.value)) throw new Error('Unexpected Solana RPC response');
    const accounts = result.result.value.map(item => {
      const amount = item.account.data.parsed.info.tokenAmount.amount;
      if (!/^[0-9]+$/.test(amount) || !walletKey(item.pubkey)) throw new Error('Unexpected token account');
      return { address: item.pubkey, amount };
    });
    return json({ accounts });
  } catch (error) {
    return json({ error: error.message || asset + ' balance is unavailable.' }, 503);
  }
}

export async function profiles(request, db, url, rpcUrl) {
  const path = url.pathname.slice('/pay/_profiles'.length);
  if (request.method === 'GET') {
    if (path === '/_page' || path === '/_payments') {
      const wallet = await sessionWallet(request, db);
      if (!wallet || wallet !== request.headers.get('X-ZeTag-Wallet')) return json({ error: 'Wallet sign-in required.' }, 401);
      if (path === '/_page') {
        const row = await db.prepare('SELECT url FROM payment_pages WHERE wallet=?').bind(wallet).first();
        return json({ url: row?.url ?? null });
      }
      const records = await db.prepare(`SELECT id,tag,label,asset,amount,sender,recipient,signature,created_at AS createdAt FROM payment_intents WHERE status='paid' AND (sender=?1 OR recipient=?1) ORDER BY created_at DESC LIMIT 50`).bind(wallet).all();
      return json({ payments: records.results.map(row => ({ id: row.id, tag: row.tag, name: row.label, asset: row.asset, amount: row.amount, signature: row.signature, createdAt: row.createdAt, direction: row.sender === wallet ? 'sent' : 'received' })) });
    }
    if (path === '/_balance') return tokenBalance(request, db, rpcUrl, url);
    if (path === '/_search') return search(db, url);
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
  if (path === '/_page') {
    const wallet = await sessionWallet(request, db);
    if (!wallet || wallet !== request.headers.get('X-ZeTag-Wallet')) return json({ error: 'Wallet sign-in required.' }, 401);
    const owner = await db.prepare('SELECT tag FROM profiles WHERE wallet=?').bind(wallet).first();
    let page;
    try { page = new URL(input?.url); } catch { return json({ error: 'Invalid payment page.' }, 400); }
    const fields = new URLSearchParams(page.hash.slice(1));
    if (!owner || page.origin !== url.origin || page.pathname !== '/pay/' || fields.get('profile') !== '1' || fields.get('tag') !== owner.tag || page.href.length > 5000) return json({ error: 'Use your own claimed ZeTag for this page.' }, 400);
    await db.prepare('INSERT INTO payment_pages(wallet,url,updated_at) VALUES (?,?,?) ON CONFLICT(wallet) DO UPDATE SET url=excluded.url,updated_at=excluded.updated_at').bind(wallet,page.href,Date.now()).run();
    return json({ saved: true });
  }
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

