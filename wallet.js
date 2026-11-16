'use strict';

(() => {
  const get = id => document.getElementById(id);
  const dialog = get('wallet-dialog');
  const history = get('history-dialog');
  const options = get('wallet-options');
  const action = get('wallet-action');
  const fallback = get('wallet-fallback');
  const historyAction = get('history-action');
  const rpcUrl = document.querySelector('meta[name="solana-rpc"]')?.content || 'https://api.mainnet-beta.solana.com';
  const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const recentLimit = 20;
  const wallets = new Set();
  const known = [
    { name: 'Jupiter', site: 'https://jup.ag/mobile' },
    { name: 'Phantom', site: 'https://phantom.com/download', injected: () => window.phantom?.solana },
    { name: 'Solflare', site: 'https://solflare.com/', injected: () => window.solflare },
    { name: 'Backpack', site: 'https://backpack.app/', injected: () => window.backpack?.solana ?? window.backpack }
  ];
  let choice = '';
  let session = null;
  let address = '';
  let request;
  let busy = false;
  let openedFromPayment = false;

  function register(...items) {
    for (const wallet of items) wallets.add(wallet);
    if (dialog.open) renderWallet();
    return () => {
      for (const wallet of items) wallets.delete(wallet);
      if (dialog.open) renderWallet();
    };
  }

  const api = Object.freeze({ register });
  window.addEventListener('wallet-standard:register-wallet', event => event.detail(api));
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));

  function adapter(entry) {
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
        disconnect: () => standard.features['standard:disconnect']?.disconnect(),
        listen: change => standard.features['standard:events']?.on('change', event => {
          if (event.accounts) change(solanaAccount(event.accounts));
        })
      };
    }
    const injected = entry.injected?.();
    if (!injected?.connect) return null;
    return {
      connect: async () => (await injected.connect())?.publicKey?.toString() ?? injected.publicKey?.toString(),
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
    get('wallet-label').textContent = address ? address.slice(0, 4) + '…' + address.slice(-4) : 'Connect Wallet';
    get('wallet-title').textContent = address ? 'Connected wallet' : 'Connect Wallet';
    get('wallet-status').textContent = error || address;
    options.hidden = Boolean(address);
    if (!choice || (!dialog.open && !address && !adapter(known.find(item => item.name === choice)))) {
      choice = (known.find(item => adapter(item)) ?? known[1]).name;
    }
    options.replaceChildren();
    for (const item of known) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wallet-option';
      button.setAttribute('aria-pressed', String(item.name === choice));
      button.setAttribute('aria-label', item.name);
      button.title = item.name;
      const icon = document.createElement('span');
      icon.className = 'wallet-logo wallet-logo-' + item.name.toLowerCase();
      icon.setAttribute('aria-hidden', 'true');
      button.append(icon);
      button.onclick = () => { choice = item.name; renderWallet(); options.querySelector('[aria-pressed="true"]')?.focus(); };
      options.append(button);
    }
    const selected = known.find(item => item.name === choice);
    const available = Boolean(adapter(selected));
    action.disabled = busy;
    action.textContent = address ? 'Disconnect' : 'Connect Wallet';
    fallback.hidden = Boolean(address) || available;
    const phantomMobile = choice === 'Phantom' && /Android|iPhone|iPad/i.test(navigator.userAgent) && location.protocol === 'https:';
    fallback.href = phantomMobile
      ? 'https://phantom.app/ul/browse/' + encodeURIComponent(location.href) + '?ref=' + encodeURIComponent(location.origin)
      : selected.site;
    fallback.textContent = phantomMobile ? 'Open in Phantom' : 'Get ' + choice;
  }

  function updateAccount(next = '') {
    next = next || '';
    if (next === address) return;
    request?.abort();
    address = next;
    get('wallet-gate').hidden = Boolean(address);
    const controls = get('payment-controls');
    controls.hidden = !address;
    controls.inert = !address;
    if (!address) {
      session?.unsubscribe?.();
      session = null;
    }
    renderWallet();
    refresh();
  }

  function openWallet(fromPayment = false) {
    openedFromPayment = fromPayment;
    renderWallet();
    dialog.showModal();
  }

  get('wallet-button').onclick = () => openWallet();
  get('wallet-gate-button').onclick = () => openWallet(true);
  get('history-button').onclick = () => history.showModal();
  historyAction.onclick = () => {
    if (address) { refresh(); return; }
    history.close();
    openWallet();
  };

  action.onclick = async () => {
    if (busy) return;
    busy = true;
    action.disabled = true;
    try {
      if (session && address) {
        await session.wallet.disconnect();
        updateAccount();
      } else {
        const wallet = adapter(known.find(item => item.name === choice));
        if (!wallet) { renderWallet(choice + ' was not detected in this browser.'); return; }
        const key = await wallet.connect();
        if (!key) throw new Error('No Solana account');
        session = { wallet, unsubscribe: wallet.listen(updateAccount) };
        updateAccount(key);
        if (openedFromPayment && dialog.open) {
          dialog.close();
          get('panel').querySelector('input')?.focus();
        }
      }
    } catch (error) {
      renderWallet(error?.code === 4001 ? 'Connection declined.' : 'Wallet request failed. Please try again.');
    } finally {
      busy = false;
      action.disabled = false;
    }
  };

  async function rpc(method, params, signal) {
    const response = await fetch(rpcUrl, {
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

  function format(amount) {
    const [whole, fraction] = amount.toString().padStart(7, '0').replace(/(.{6})$/, '.$1').split('.');
    return BigInt(whole).toLocaleString('en-US') + '.' + fraction.replace(/0+$/, '').padEnd(2, '0') + ' USDC';
  }

  function deltaFor(tx, owner, accounts) {
    if (!tx?.meta || tx.meta.err) return 0n;
    const keys = tx.transaction.message.accountKeys;
    const sum = balances => (balances ?? []).reduce((total, item) => {
      const tokenAccount = keys[item.accountIndex]?.pubkey;
      return item.mint === usdc && (item.owner === owner || (!item.owner && accounts.has(tokenAccount)))
        ? total + BigInt(item.uiTokenAmount.amount)
        : total;
    }, 0n);
    return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  }

  async function refresh() {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const signal = controller.signal;
    const owner = address;
    const status = get('wallet-data-status');
    const historyStatus = get('history-status');
    const list = get('history-list');
    list.replaceChildren();
    for (const id of ['wallet-balance','wallet-received','wallet-sent']) get(id).textContent = '—';
    historyAction.textContent = owner ? 'Refresh' : 'Connect Wallet';
    historyStatus.textContent = owner ? 'Loading recent USDC activity…' : 'Connect a Solana wallet to view recent USDC activity.';
    if (!owner) {
      get('wallet-balance').textContent = 'Not connected';
      status.textContent = '';
      return;
    }
    status.textContent = 'Loading wallet data…';
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const result = await rpc('getTokenAccountsByOwner', [owner, { mint: usdc }, { encoding: 'jsonParsed' }], signal);
      if (request !== controller) return;
      const byAccount = new Set(result.value.map(item => item.pubkey));
      get('wallet-balance').textContent = format(result.value.reduce((total, item) =>
        total + BigInt(item.account.data.parsed.info.tokenAmount.amount), 0n));
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
      for (let i = 0; i < recent.length; i += 4) {
        const chunk = recent.slice(i, i + 4);
        const results = await Promise.allSettled(chunk.map(item =>
          rpc('getTransaction', [item.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }], signal)));
        if (request !== controller || signal.aborted) return;
        results.forEach((result, index) => {
          if (result.status !== 'fulfilled' || !result.value) { missing = true; return; }
          const item = chunk[index];
          const change = deltaFor(result.value, owner, byAccount);
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
          label.textContent = inbound ? 'Received' : 'Sent';
          if (item.blockTime) {
            const date = document.createElement('small');
            date.textContent = new Date(item.blockTime * 1000).toLocaleString();
            label.append(date);
          }
          link.append(label, (inbound ? '+' : '−') + format(amount));
          row.append(link);
          list.append(row);
        });
      }
      if (request !== controller) return;
      const scope = 'Totals cover the latest ' + recent.length + ' candidate transactions from the wallet and up to four current USDC accounts.';
      status.textContent = missing ? 'Some transaction data was unavailable. Refresh to retry.' : scope;
      if (!missing) {
        get('wallet-received').textContent = format(received);
        get('wallet-sent').textContent = format(sent);
      }
      historyStatus.textContent = missing ? status.textContent : list.children.length
        ? scope : 'No USDC balance changes found in the recent transactions checked.';
    } catch {
      if (request !== controller) return;
      status.textContent = historyStatus.textContent = 'Could not load all wallet data. Try refreshing.';
    } finally {
      clearTimeout(timeout);
      if (request === controller && signal.aborted) status.textContent = historyStatus.textContent = 'Wallet data request timed out. Try refreshing.';
    }
  }

  refresh();
})();
