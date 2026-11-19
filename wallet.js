'use strict';

(() => {
  const get = id => document.getElementById(id);
  const dialog = get('wallet-dialog');
  const history = get('history-dialog');
  const options = get('wallet-options');
  const action = get('wallet-action');
  const fallback = get('wallet-fallback');
  const disconnect = get('wallet-disconnect');
  const historyAction = get('history-action');
  const rpcUrl = document.querySelector('meta[name="solana-rpc"]')?.content || 'https://api.mainnet-beta.solana.com';
  const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const recentLimit = 20;
  const wallets = new Set();
  const known = [
    { name: 'Jupiter', site: 'https://jup.ag/mobile' },
    {
      name: 'Phantom', site: 'https://phantom.com/download',
      injected: () => window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null)
    },
    {
      name: 'Solflare', site: 'https://solflare.com/',
      injected: () => window.solflare ?? (window.solana?.isSolflare ? window.solana : null)
    },
    {
      name: 'Backpack', site: 'https://backpack.app/',
      injected: () => window.backpack?.solana ?? window.backpack ?? (window.solana?.isBackpack ? window.solana : null)
    }
  ];
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

  let choice = '';
  let session = null;
  let address = '';
  let request;
  let balanceRequest;
  const balances = { USDC: null, SOL: null };
  let busy = false;
  let pendingForm = null;
  let restoring = false;
  const providerKey = 'zetag:wallet-provider';

  function rememberedProvider() {
    try { return localStorage.getItem(providerKey); } catch { return null; }
  }

  function rememberProvider(name) {
    try {
      if (name) localStorage.setItem(providerKey, name);
      else localStorage.removeItem(providerKey);
    } catch {}
  }

  function register(...items) {
    for (const wallet of items) wallets.add(wallet);
    if (dialog.open) renderWallet();
    void restoreWallet();
    return () => {
      for (const wallet of items) wallets.delete(wallet);
      if (dialog.open) renderWallet();
    };
  }

  const api = Object.freeze({ register });
  window.addEventListener('wallet-standard:register-wallet', event => event.detail(api));

  function adapter(entry) {
    if (!entry) return null;
    const standard = [...wallets].find(wallet =>
      wallet.name.toLowerCase().includes(entry.name.toLowerCase()) &&
      wallet.chains.some(chain => chain.startsWith('solana:')) &&
      wallet.features['standard:connect']
    );
    if (standard) {
      const solanaAccount = accounts => accounts.find(account =>
        account.chains.some(chain => chain.startsWith('solana:'))
      )?.address;
      return {
        connect: async () => solanaAccount((await standard.features['standard:connect'].connect()).accounts),
        restore: async () => solanaAccount(standard.accounts) ??
          solanaAccount((await standard.features['standard:connect'].connect({ silent: true })).accounts),
        sign: async (message, address) => {
          const account = standard.accounts.find(item => item.address === address);
          const feature = standard.features['solana:signMessage'];
          if (!account || !feature) throw new Error('This wallet does not support profile signatures.');
          const [result] = await feature.signMessage({ account, message });
          return result.signature;
        },
        disconnect: () => standard.features['standard:disconnect']?.disconnect(),
        listen: change => standard.features['standard:events']?.on('change', event => {
          if (event.accounts) change(solanaAccount(event.accounts));
        })
      };
    }
    const injected = entry.injected?.();
    if (!injected?.connect) return mobile ? window.ZeTagMobile?.adapter(entry.name) ?? null : null;
    return {
      connect: async () => (await injected.connect())?.publicKey?.toString() ?? injected.publicKey?.toString(),
      restore: async () => {
        if (injected.isConnected && injected.publicKey) return injected.publicKey.toString();
        if (entry.name === 'Phantom') {
          return (await injected.connect({ onlyIfTrusted: true }))?.publicKey?.toString();
        }
      },
      sign: async message => {
        if (!injected.signMessage) throw new Error('This wallet does not support profile signatures.');
        const result = await injected.signMessage(message);
        return result.signature ?? result;
      },
      disconnect: () => injected.disconnect?.(),
      listen: change => {
        const account = key => change(key?.toString());
        const close = () => change();
        injected.on?.('accountChanged', account);
        injected.on?.('disconnect', close);
        return () => {
          injected.removeListener?.('accountChanged', account);
          injected.removeListener?.('disconnect', close);
        };
      }
    };
  }

  function renderWallet(error = '') {
    const shortAddress = address ? address.slice(0, 5) + '…' + address.slice(-5) : '';
    get('wallet-label').textContent = shortAddress || 'Connect Wallet';
    get('wallet-title').textContent = address ? 'Connected wallet' : 'Connect Wallet';
    get('wallet-status').textContent = error || shortAddress;
    get('wallet-status').title = address;
    get('wallet-prompt').hidden = Boolean(address);
    disconnect.hidden = !address;
    disconnect.disabled = busy;
    dialog.classList.toggle('wallet-connected', Boolean(address));
    get('wallet-refresh').hidden = !address;
    get('wallet-view-history').hidden = !address;
    options.hidden = Boolean(address);
    if (!choice || (!dialog.open && !address && !adapter(known.find(item => item.name === choice)))) {
      choice = (known.find(item => adapter(item)) ?? known[1]).name;
    }
    options.replaceChildren();
    for (const item of known) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'wallet-option';
      control.disabled = busy;
      control.setAttribute('aria-label', item.name);
      control.setAttribute('aria-pressed', String(item.name === choice));
      const icon = document.createElement('span');
      icon.className = 'wallet-logo wallet-logo-' + item.name.toLowerCase();
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'wallet-option-label';
      label.textContent = item.name;
      control.append(icon, label);
      control.onclick = () => {
        if (busy || address) return;
        choice = item.name;
        renderWallet();
        options.querySelector('[aria-pressed="true"]')?.focus();
      };
      options.append(control);
    }
    action.textContent = 'Connect';
    action.hidden = Boolean(address);
    action.disabled = busy;
    fallback.hidden = true;
    get('wallet-prompt').textContent = 'Choose a wallet, then tap Connect.';
  }

  function updateAccount(next = '') {
    next = next || '';
    if (next === address) return;
    request?.abort();
    address = next;
    balances.USDC = balances.SOL = null;
    const identity = get('wallet-identity');
    if (identity) { identity.hidden = true; identity.replaceChildren(); }
    if (!address) {
      session?.unsubscribe?.();
      session = null;
    }
    renderWallet();
    document.dispatchEvent(new CustomEvent('zetag:wallet-changed', { detail: { address } }));
    refresh();
  }

  async function restoreWallet() {
    if (address || busy || restoring || dialog.open) return;
    const remembered = rememberedProvider();
    const wallet = adapter(known.find(item => item.name === remembered));
    if (!wallet) return;
    restoring = true;
    try {
      const key = await wallet.restore();
      if (!key || address || busy || dialog.open || rememberedProvider() !== remembered) return;
      choice = remembered;
      session = { wallet, unsubscribe: wallet.listen(updateAccount) };
      updateAccount(key);
    } catch {
      // The wallet requires an explicit connection on this visit.
    } finally {
      restoring = false;
    }
  }

  function openWallet() {
    renderWallet();
    dialog.showModal();
  }

  window.ZeTagWallet = Object.freeze({
    get address() { return address; },
    get balance() { return balances[ZeTagTokens.selected]; },
    balanceOf(asset) { return balances[asset] ?? null; },
    get balanceText() { const value = balances[ZeTagTokens.selected]; return value === null ? '' : format(value); },
    async signMessage(value, completion) {
      const signer = address;
      if (!session || !signer) throw new Error('Connect your wallet first.');
      const bytes = await session.wallet.sign(new TextEncoder().encode(value), signer, completion);
      if (signer !== address || bytes?.length !== 64) throw new Error('Wallet changed or returned an invalid signature.');
      return btoa(String.fromCharCode(...bytes));
    }
  });

  get('wallet-button').onclick = () => openWallet();
  get('panel')?.addEventListener('zetag:payment-submit', event => {
    if (address) return;
    event.preventDefault();
    pendingForm = { form: event.target, submitter: event.detail?.submitter };
    if (!dialog.open) openWallet();
  });
  dialog.addEventListener('close', () => { pendingForm = null; });
  document.addEventListener('zetag:wallet-profile', ({ detail }) => {
    const identity = get('wallet-identity');
    if (!identity || detail.owner !== address || !window.ZeTagUI) return;
    const profile = detail.profile;
    identity.hidden = !profile;
    if (profile) {
      const tag = document.createElement('strong');
      tag.textContent = '@' + profile.tag;
      identity.replaceChildren(window.ZeTagUI.avatar(profile, 'avatar-contact'), tag);
    } else identity.replaceChildren();
  });
  document.addEventListener('zetag:profile-session', () => {
    if (address && balances[ZeTagTokens.selected] === null) void refresh();
  });
  get('history-button').onclick = () => history.showModal();
  historyAction.onclick = () => {
    if (address) { refresh(); return; }
    history.close();
    openWallet();
  };

  get('wallet-refresh').onclick = () => refresh();
  get('wallet-view-history').onclick = () => {
    dialog.close();
    history.showModal();
  };

  disconnect.onclick = async () => {
    if (busy || !session) return;
    busy = true;
    disconnect.disabled = true;
    try {
      await session.wallet.disconnect();
      rememberProvider('');
      updateAccount();
      const response = await fetch('/pay/_profiles/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error();
      document.dispatchEvent(new CustomEvent('zetag:wallet-signed-out'));
    } catch {
      renderWallet('Could not disconnect. Please try again.');
    } finally {
      busy = false;
      disconnect.disabled = false;
    }
  };

  async function connectWallet(entry, wallet) {
    if (busy || address) return;
    busy = true;
    action.disabled = true;
    get('wallet-status').textContent = 'Check ' + entry.name + ' to approve the connection.';
    try {
      const key = await wallet.connect();
      if (!key) throw new Error('No Solana account');
      rememberProvider(entry.name);
      session = { wallet, unsubscribe: wallet.listen(updateAccount) };
      updateAccount(key);
      const pending = pendingForm;
      pendingForm = null;
      if (pending?.form.isConnected && dialog.open) {
        dialog.close();
        pending.form.requestSubmit(pending.submitter);
      }
    } catch (error) {
      renderWallet(error?.code === 4001 ? 'Connection declined.' : 'Wallet request failed. Please try again.');
    } finally {
      busy = false;
      action.disabled = false;
      disconnect.disabled = false;
    }
  }

  action.onclick = () => {
    const entry = known.find(item => item.name === choice);
    const wallet = adapter(entry);
    if (wallet) void connectWallet(entry, wallet);
    else renderWallet(mobile && entry.name === 'Jupiter'
      ? 'Jupiter Mobile connection is being configured. You can connect from its built-in browser for now.'
      : entry.name + ' is unavailable in this browser. Check that its extension is enabled.');
  };

  async function rpc(method, params, signal, endpoint = rpcUrl) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal
    });
    if (!response.ok) throw new Error('RPC unavailable');
    const payload = await response.json();
    if (payload.error || !Object.hasOwn(payload, 'result')) throw new Error('RPC request failed');
    return payload.result;
  }

  async function loadBalance(owner, controller, asset) {
    const status = get('wallet-balance-status');
    const balance = get('wallet-balance');
    balance.textContent = 'Loading…';
    status.textContent = '';
    const providers = [...new Set([rpcUrl, 'https://solana-rpc.publicnode.com'])].map(endpoint => async signal => {
      if (asset === 'SOL') {
        const result = await rpc('getBalance', [owner, { commitment: 'confirmed' }], signal, endpoint);
        if (!Number.isSafeInteger(result.value) || result.value < 0) throw new Error('Invalid SOL balance');
        return [{ address: owner, amount: String(result.value) }];
      }
      const result = await rpc('getTokenAccountsByOwner', [owner, { mint: usdc }, {
        encoding: 'jsonParsed', commitment: 'confirmed'
      }], signal, endpoint);
      return result.value.map(item => ({ address: item.pubkey, amount: item.account.data.parsed.info.tokenAmount.amount }));
    });
    if (window.ZeTagUI) providers.push(async signal => {
      const data = await window.ZeTagUI.api('/_balance?asset=' + asset, null, signal);
      if (asset === 'SOL') return [{ address: owner, amount: data.amount }];
      return data.accounts;
    });
    try {
      const accounts = await Promise.any(providers.map(async provider => {
        const result = await provider(AbortSignal.any([controller.signal, AbortSignal.timeout(6500)]));
        if (!Array.isArray(result) || result.some(account => typeof account.address !== 'string' ||
          typeof account.amount !== 'string' || !/^[0-9]+$/.test(account.amount))) throw new Error('Invalid balance');
        return result;
      }));
      if (controller.signal.aborted) return null;
      balances[asset] = accounts.reduce((sum, item) => sum + BigInt(item.amount), 0n);
      balance.textContent = format(balances[asset], asset);
      document.dispatchEvent(new Event('zetag:wallet-balance'));
      return new Set(asset === 'SOL' ? [] : accounts.map(item => item.address));
    } catch {
      if (controller.signal.aborted) return null;
      balance.textContent = 'Unavailable';
      status.textContent = 'Could not load the ' + asset + ' balance. Refresh to try again.';
      return null;
    }
  }

  function format(amount, asset = ZeTagTokens.selected) {
    return ZeTagTokens.formatUnits(amount, asset) + ' ' + asset;
  }

  function deltaFor(tx, owner, accounts, asset) {
    if (!tx?.meta || tx.meta.err) return 0n;
    const keys = tx.transaction.message.accountKeys;
    if (asset === 'SOL') {
      const index = keys.findIndex(key => (key.pubkey ?? key) === owner);
      const before = tx.meta.preBalances?.[index];
      const after = tx.meta.postBalances?.[index];
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after)) throw new Error('Invalid SOL history');
      return BigInt(after) - BigInt(before);
    }
    const sum = balances => (balances ?? []).reduce((total, item) => {
      const tokenAccount = keys[item.accountIndex]?.pubkey;
      return item.mint === usdc && (item.owner === owner || (!item.owner && accounts.has(tokenAccount)))
        ? total + BigInt(item.uiTokenAmount.amount)
        : total;
    }, 0n);
    return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  }

  function openReceipt({ signature, blockTime }, amount, inbound, asset) {
    const direction = asset === 'SOL' ? (inbound ? 'Balance increase' : 'Balance decrease') : (inbound ? 'Received' : 'Sent');
    const date = blockTime ? new Date(blockTime * 1000) : null;
    const url = 'https://explorer.solana.com/tx/' + encodeURIComponent(signature);
    const receipt = get('receipt-dialog');
    const text = get('receipt-text');
    const feedback = get('receipt-feedback');
    get('receipt-amount').textContent = direction + ' ' + format(amount, asset);
    get('receipt-date').textContent = date ? date.toLocaleString() : 'Date unavailable';
    get('receipt-link').href = url;
    text.value = ['Solana ' + asset + ' balance-change receipt', direction + ' ' + format(amount, asset), date?.toISOString(), url].filter(Boolean).join('\n');
    text.hidden = true;
    feedback.textContent = '';
    get('receipt-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(text.value);
        feedback.textContent = 'Receipt copied.';
      } catch {
        text.hidden = false;
        text.focus();
        text.select();
        feedback.textContent = 'Copy the selected receipt.';
      }
    };
    receipt.showModal();
  }

  async function refresh() {
    request?.abort();
    balanceRequest?.abort();
    const controller = new AbortController();
    request = controller;
    const signal = controller.signal;
    const owner = address;
    const asset = ZeTagTokens.selected;
    balances[asset] = null;
    document.dispatchEvent(new Event('zetag:wallet-balance'));
    const status = get('wallet-data-status');
    const historyStatus = get('history-status');
    const list = get('history-list');
    list.replaceChildren();
    for (const id of ['wallet-balance','wallet-received','wallet-sent']) get(id).textContent = '—';
    historyAction.textContent = owner ? 'Refresh' : 'Connect Wallet';
    historyStatus.textContent = owner ? 'Loading recent ' + asset + ' activity…' : 'Connect a Solana wallet to view recent activity.';
    get('wallet-balance-label').textContent = asset + ' balance';
    get('wallet-received-label').textContent = asset === 'SOL' ? 'Recent increases' : 'Recent received';
    get('wallet-sent-label').textContent = asset === 'SOL' ? 'Recent decreases' : 'Recent sent';
    if (!owner) {
      get('wallet-balance').textContent = 'Not connected';
      status.textContent = '';
      get('wallet-balance-status').textContent = '';
      return;
    }
    status.textContent = 'Loading recent ' + asset + ' activity…';
    balanceRequest = new AbortController();
    const accounts = await loadBalance(owner, balanceRequest, asset);
    if (request !== controller) return;
    const byAccount = accounts ?? new Set();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const signatures = new Map();
      const scan = [owner, ...[...byAccount].slice(0, 4)];
      for (const key of scan) {
        const items = await rpc('getSignaturesForAddress', [key, { limit: recentLimit }], signal);
        for (const item of items) if (!item.err) signatures.set(item.signature, item);
      }
      const recent = [...signatures.values()].sort((a, b) => b.slot - a.slot).slice(0, recentLimit);
      let sent = 0n;
      let received = 0n;
      let missing = false;
      const transactions = [];
      for (let i = 0; i < recent.length; i += 4) {
        const chunk = recent.slice(i, i + 4);
        const results = await Promise.allSettled(chunk.map(item =>
          rpc('getTransaction', [item.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }], signal)));
        if (request !== controller || signal.aborted) return;
        results.forEach((result, index) => {
          if (result.status !== 'fulfilled' || !result.value) { missing = true; return; }
          const item = chunk[index];
          const change = deltaFor(result.value, owner, byAccount, asset);
          if (!change) return;
          const inbound = change > 0n;
          const amount = inbound ? change : -change;
          if (inbound) received += amount; else sent += amount;
          const row = document.createElement('li');
          const link = document.createElement('a');
          link.href = 'https://explorer.solana.com/tx/' + encodeURIComponent(item.signature);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          const label = document.createElement('span');
          label.textContent = asset === 'SOL' ? (inbound ? 'Balance increase' : 'Balance decrease') : (inbound ? 'Received' : 'Sent');
          if (item.blockTime) {
            const date = document.createElement('small');
            date.textContent = new Date(item.blockTime * 1000).toLocaleString();
            label.append(date);
          }
          link.append(label, (inbound ? '+' : '−') + format(amount, asset));
          row.append(link);
          if (item.confirmationStatus === 'finalized' || item.confirmationStatus === 'confirmed') {
            transactions.push({ signature: item.signature, amount: format(amount, asset), inbound });
            const receiptButton = document.createElement('button');
            receiptButton.type = 'button';
            receiptButton.className = 'receipt-button';
            receiptButton.textContent = 'Receipt';
            receiptButton.onclick = () => openReceipt(item, amount, inbound, asset);
            row.append(receiptButton);
          }
          list.append(row);
        });
      }
      if (request !== controller) return;
      document.dispatchEvent(new CustomEvent('zetag:wallet-activity', { detail: { owner, transactions } }));
      const scope = (accounts ? '' : 'Wallet address only. ') + 'Totals cover the latest ' + recent.length + ' candidate transactions from the wallet and up to four current USDC accounts.' + (asset === 'SOL' ? ' SOL changes include network fees and account rent.' : '');
      status.textContent = missing ? 'Some transaction data was unavailable. Refresh to retry.' : scope;
      if (!missing) {
        get('wallet-received').textContent = format(received);
        get('wallet-sent').textContent = format(sent);
      }
      historyStatus.textContent = missing ? status.textContent : list.children.length
        ? scope : 'No balance changes found in the recent transactions checked.';
    } catch {
      if (request !== controller) return;
      status.textContent = historyStatus.textContent = 'Could not load transaction history. Try refreshing.';
    } finally {
      clearTimeout(timeout);
      if (request === controller && signal.aborted) status.textContent = historyStatus.textContent = 'Transaction history timed out. Try refreshing.';
    }
  }

  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  document.addEventListener('zetag:asset-changed', () => { void refresh(); });
  window.addEventListener('load', restoreWallet, { once: true });
  void restoreWallet();
  refresh();
  setInterval(() => {
    if (address && !document.hidden && !dialog.open && !history.open) void refresh();
  }, 90000);
})();
