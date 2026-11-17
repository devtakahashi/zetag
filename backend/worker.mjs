import { profiles } from './profiles.mjs';

const slugPattern = /^[a-z0-9][a-z0-9_.-]{2,100}$/;
const json = (value, status = 200) => Response.json(value, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});

async function create(request, env, url) {
  if (request.headers.get('Origin') !== url.origin) return json({ error: 'Origin forbidden' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({ error: 'JSON required' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'Body required' }, 400);
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 2048) {
      await reader.cancel();
      return json({ error: 'Request too large' }, 413);
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  let input;
  try { input = JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { tag, amount, name, note = '' } = input ?? {};
  if (typeof tag !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,23}$/.test(tag) ||
      typeof amount !== 'string' || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(amount) || !/[1-9]/.test(amount) ||
      typeof name !== 'string' || !name.trim() || name.length > 50 ||
      typeof note !== 'string' || note.length > 100) return json({ error: 'Invalid payment request' }, 400);
  const label = amount.length <= 24 ? amount : 'usdc';
  const id = crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const slug = [tag, label, id].join('-');
  await env.DB.prepare('INSERT INTO payment_requests (slug, tag, amount, name, note) VALUES (?, ?, ?, ?, ?)')
    .bind(slug, tag, amount, name, note).run();
  return json({ slug }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/pay/_profiles' || url.pathname.startsWith('/pay/_profiles/')) {
        return await profiles(request, env.DB, url);
      }
      if (url.pathname === '/pay/_requests' && request.method === 'POST') return await create(request, env, url);
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (url.pathname.startsWith('/pay/_requests/')) {
        const slug = url.pathname.slice('/pay/_requests/'.length);
        if (!slugPattern.test(slug)) return json({ error: 'Request not found' }, 404);
        const record = await env.DB.prepare('SELECT tag, amount, name, note FROM payment_requests WHERE slug = ?')
          .bind(slug).first();
        return record ? json(record) : json({ error: 'Request not found' }, 404);
      }
      if (url.pathname === '/pay') return Response.redirect(new URL('/pay/', url), 308);
      if (url.pathname === '/pay/' || slugPattern.test(url.pathname.slice('/pay/'.length))) {
        return env.ASSETS.fetch(new Request(new URL('/index.html', url)));
      }
      return json({ error: 'Not found' }, 404);
    } catch {
      return json({ error: 'Payment service unavailable' }, 503);
    }
  }
};
