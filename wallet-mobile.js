'use strict';

(() => {
  const root = new URL('./', document.currentScript.src);
  const callback = new URL('wallet-return/', root);
  const providers = {
    Phantom: { base: 'https://phantom.com/ul/v1/', key: 'phantom_encryption_public_key' },
    Solflare: { base: 'https://solflare.com/ul/v1/', key: 'solflare_encryption_public_key' },
    Backpack: { base: 'https://backpack.app/ul/v1/', key: 'wallet_encryption_public_key' }
  };
  const sessionKey = 'zetag:mobile-session';
  const activeKey = 'zetag:mobile-active-request';
  let handedOff = false;
  const pendingPrefix = 'zetag:mobile-request:';
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const encode = new TextEncoder();
  const decode = new TextDecoder('utf-8', { fatal: true });

  function base58(bytes) {
    let value = 0n;
    for (const byte of bytes) value = value * 256n + BigInt(byte);
    let result = '';
    while (value) {
      result = alphabet[Number(value % 58n)] + result;
      value /= 58n;
    }
    for (const byte of bytes) { if (byte) break; result = '1' + result; }
    return result;
  }

  function unbase58(value, length) {
    if (typeof value !== 'string' || !value || value.length > 16384 || /[^1-9A-HJ-NP-Za-km-z]/.test(value)) {
      throw new Error('Invalid wallet response.');
    }
    let number = 0n;
    for (const char of value) number = number * 58n + BigInt(alphabet.indexOf(char));
    const bytes = [];
    while (number) { bytes.unshift(Number(number & 255n)); number >>= 8n; }
    const result = Uint8Array.from([...Array(value.match(/^1*/)[0].length).fill(0), ...bytes]);
    if (length && result.length !== length) throw new Error('Invalid wallet response.');
    return result;
  }

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function write(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function current(name) {
    const saved = read(sessionKey);
    if (!saved || saved.name !== name || !providers[name] || !Number.isFinite(saved.created) || saved.created > Date.now() || Date.now() - saved.created > 7 * 86400000) return null;
    try {
      unbase58(saved.secret, 32);
      unbase58(saved.walletKey, 32);
      unbase58(saved.address, 32);
      if (typeof saved.session !== 'string' || !saved.session || saved.session.length > 10000) return null;
      return saved;
    } catch { return null; }
  }

  function safeReturn(value) {
    const url = new URL(value, root);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname) || url.pathname === callback.pathname) {
      throw new Error('Invalid return page.');
    }
    return url.href;
  }

  function launch(name, method, record, params) {
    if (location.protocol !== 'https:') throw new Error('Use the secure ZeTag website to connect.');
    // Confirm storage access before leaving the browser.
    const state = base58(crypto.getRandomValues(new Uint8Array(24)));
    const requestKey = pendingPrefix + state;
    const previous = localStorage.getItem(activeKey);
    if (previous) localStorage.removeItem(pendingPrefix + previous);
    write(requestKey, { ...record, name, method, created: Date.now(), returnTo: safeReturn(location.href) });
    const returnUrl = new URL(callback);
    returnUrl.searchParams.set('state', state);
    const url = new URL(method, providers[name].base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('redirect_link', returnUrl.href);
    localStorage.setItem(activeKey, state);
    handedOff = true;
    location.assign(url.href);
    return new Promise(() => {});
  }

  function connect(name) {
    const keys = nacl.box.keyPair();
    return launch(name, 'connect', { secret: base58(keys.secretKey) }, {
      app_url: root.href, cluster: 'mainnet-beta', dapp_encryption_public_key: base58(keys.publicKey)
    });
  }

  function sign(name, message, address, completion) {
    const saved = current(name);
    if (!saved || saved.address !== address) throw new Error('Reconnect your wallet.');
    if (!completion || !['/pay/_profiles','/pay/_profiles/login'].includes(completion.endpoint) ||
        !/^[0-9a-f-]{36}$/.test(completion.nonce) ||
        !decode.decode(message).includes('Nonce: ' + completion.nonce)) {
      throw new Error('Start a new profile sign-in or edit.');
    }
    const secret = unbase58(saved.secret, 32);
    const key = nacl.box.before(unbase58(saved.walletKey, 32), secret);
    const nonce = nacl.randomBytes(24);
    const payload = encode.encode(JSON.stringify({ message: base58(message), session: saved.session, display: 'utf8' }));
    return launch(name, 'signMessage', {
      secret: saved.secret, address, walletKey: saved.walletKey, completion, message: base58(message)
    }, {
      dapp_encryption_public_key: base58(nacl.box.keyPair.fromSecretKey(secret).publicKey),
      nonce: base58(nonce), payload: base58(nacl.box.after(payload, nonce, key))
    });
  }

  function adapter(name) {
    if (!providers[name] || !window.nacl) return null;
    return {
      connect: () => connect(name),
      restore: async () => current(name)?.address,
      sign: (message, address, completion) => sign(name, message, address, completion),
      disconnect: async () => {
        localStorage.removeItem(sessionKey);
        const active = localStorage.getItem(activeKey);
        if (active) localStorage.removeItem(pendingPrefix + active);
        localStorage.removeItem(activeKey);
      },
      listen: change => {
        const handler = event => {
          if (event.key === sessionKey) change(current(name)?.address);
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
      }
    };
  }

  async function finish() {
    const status = document.getElementById('wallet-return-status');
    const back = document.getElementById('wallet-return-back');
    const params = new URLSearchParams(location.search);
    const state = params.get('state');
    let returnTo = root.href;
    try {
      if (!state || !/^[1-9A-HJ-NP-Za-km-z]{24,40}$/.test(state)) throw new Error('This wallet request is missing or expired.');
      const requestKey = pendingPrefix + state;
      const pending = read(requestKey);
      if (localStorage.getItem(activeKey) !== state || !pending || !providers[pending.name] || !['connect','signMessage'].includes(pending.method) ||
          !Number.isFinite(pending.created) || Date.now() - pending.created > 300000 || pending.created > Date.now()) {
        throw new Error('Return to ZeTag in the browser where you started, then connect again.');
      }
      returnTo = safeReturn(pending.returnTo);
      back.href = returnTo;
      // A response can complete only the request that created this callback.
      localStorage.removeItem(requestKey);
      localStorage.removeItem(activeKey);
      history.replaceState(null, '', callback.pathname);
      if (params.has('errorCode')) throw new Error('Wallet request declined. You can try again.');
      const walletKey = pending.method === 'connect'
        ? params.get(providers[pending.name].key) : pending.walletKey;
      const secret = unbase58(pending.secret, 32);
      const key = nacl.box.before(unbase58(walletKey, 32), secret);
      const opened = nacl.box.open.after(unbase58(params.get('data')), unbase58(params.get('nonce'), 24), key);
      if (!opened) throw new Error('Could not verify the wallet response.');
      const data = JSON.parse(decode.decode(opened));
      if (pending.method === 'connect') {
        unbase58(data.public_key, 32);
        if (typeof data.session !== 'string' || !data.session || data.session.length > 10000) throw new Error('Invalid wallet session.');
        write(sessionKey, {
          name: pending.name, address: data.public_key, secret: pending.secret,
          walletKey, session: data.session, created: Date.now()
        });
        localStorage.setItem('zetag:wallet-provider', pending.name);
        status.textContent = 'Wallet connected. Returning to ZeTag…';
      } else {
        const saved = current(pending.name);
        if (!saved || saved.address !== pending.address || saved.secret !== pending.secret) throw new Error('Your wallet session changed. Connect again.');
        const signature = unbase58(data.signature, 64);
        if (!nacl.sign.detached.verify(unbase58(pending.message), signature, unbase58(pending.address, 32))) {
          throw new Error('The wallet signature could not be verified.');
        }
        const target = pending.completion;
        if (!target || !['/pay/_profiles','/pay/_profiles/login'].includes(target.endpoint)) throw new Error('Invalid profile request.');
        const response = await fetch(new URL(target.endpoint, root.origin), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonce: target.nonce, signature: btoa(String.fromCharCode(...signature)) }),
          signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) throw new Error('The profile request could not finish. Return to ZeTag and try again.');
        status.textContent = 'Profile saved. Returning to ZeTag…';
      }
      location.replace(returnTo);
    } catch (error) {
      status.textContent = error.message || 'Could not finish this wallet request.';
      back.href = returnTo;
      back.hidden = false;
    }
  }

  window.addEventListener('pageshow', event => {
    if (event.persisted && handedOff) location.reload();
  });

  window.ZeTagMobile = Object.freeze({ adapter });
  if (location.pathname === callback.pathname) void finish();
})();
