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

function publicProfile(row) {
  return json({ tag: row.tag, wallet: row.wallet, avatar: row.avatar, joinedAt: row.joined_at });
}

const select = 'SELECT tag, wallet, avatar, joined_at FROM profiles WHERE ';

export async function profiles(request, db, url) {
  const base = '/pay/_profiles';
  const path = url.pathname.slice(base.length);
  if (request.method === 'GET') {
    const tag = path.slice(1);
    const wallet = url.searchParams.get('wallet');
    if (path === '' && !walletKey(wallet)) return json({ error: 'Invalid wallet address.' }, 400);
    if (path !== '' && (!path.startsWith('/') || !tags.test(tag))) return json({ error: 'Invalid tag.' }, 400);
    const row = path === '' ? await db.prepare(select + 'wallet = ?').bind(wallet).first()
      : await db.prepare(select + 'tag = ?').bind(tag).first();
    return row ? publicProfile(row) : json({ error: 'Profile not found.' }, 404);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')) {
    return json({ error: 'Use the ZeTag website to save a profile.' }, 403);
  }
  const input = await readBody(request);
  if (path === '/challenge') {
    const { wallet, tag, avatar } = input ?? {};
    if (!walletKey(wallet) || typeof tag !== 'string' || !tags.test(tag) || !validAvatar(avatar)) {
      return json({ error: 'Check your wallet, tag, and avatar.' }, 400);
    }
    const nonce = crypto.randomUUID();
    const expires = Date.now() + 300000;
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(avatar)));
    const digest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
    const message = [
      'ZeTag profile authorization', 'Site: ' + url.origin, 'Wallet: ' + wallet,
      'Tag: @' + tag, 'Avatar hash: ' + digest, 'Nonce: ' + nonce,
      'Expires: ' + new Date(expires).toISOString(), 'This message does not authorize any transfer.'
    ].join('\n');
    await db.batch([
      db.prepare('DELETE FROM profile_challenges WHERE expires < ?').bind(Date.now()),
      db.prepare('INSERT INTO profile_challenges (nonce, wallet, tag, avatar, message, expires) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(nonce, wallet, tag, avatar, message, expires)
    ]);
    return json({ nonce, message });
  }
  if (path !== '') return json({ error: 'Route not found.' }, 404);
  const { nonce, signature } = input ?? {};
  if (typeof nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(nonce) ||
      typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) {
    return json({ error: 'Invalid profile signature.' }, 400);
  }
  const challenge = await db.prepare('SELECT * FROM profile_challenges WHERE nonce = ? AND expires >= ?')
    .bind(nonce, Date.now()).first();
  if (!challenge) return json({ error: 'This request expired. Try saving again.' }, 409);
  const key = await crypto.subtle.importKey('raw', walletKey(challenge.wallet), 'Ed25519', false, ['verify']);
  const valid = await crypto.subtle.verify('Ed25519', key, Uint8Array.from(atob(signature), c => c.charCodeAt(0)), encode.encode(challenge.message));
  if (!valid) return json({ error: 'The signature does not match the wallet.' }, 403);
  const consumed = await db.prepare('DELETE FROM profile_challenges WHERE nonce = ? AND expires >= ? RETURNING nonce')
    .bind(nonce, Date.now()).first();
  if (!consumed) return json({ error: 'This request was already used or expired.' }, 409);
  const joined = new Date().toISOString();
  const saved = await db.prepare(`
    INSERT INTO profiles (tag, wallet, avatar, joined_at) VALUES (?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET avatar = excluded.avatar
    WHERE profiles.wallet = excluded.wallet AND profiles.tag = excluded.tag
    RETURNING tag, wallet, avatar, joined_at
  `).bind(challenge.tag, challenge.wallet, challenge.avatar, joined).first();
  return saved ? publicProfile(saved) : json({ error: 'This tag or wallet already belongs to a different profile.' }, 409);
}
