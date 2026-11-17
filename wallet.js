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
    { name: 'Phantom', site: 'https://phantom.com/download', injected: () => window.phantom?.solana },
    { name: 'Solflare', site: 'https://solflare.com/', injected: () => window.solflare },
    { name: 'Backpack', site: 'https://backpack.app/', injected: () => window.backpack?.solana ?? window.backpack }
  ];
  let choice = '';
  let session = null;
  let address = '';
  let request;
  let balanceRequest;
  let busy = false;
  let pendingForm = null;

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
    if (!injected?.connect) return null;
    return {
      connect: async () => (await injected.connect())?.publicKey?.toString() ?? injected.publicKey?.toString(),
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
    get('wallet-label').textContent = address ? address.slice(0, 4) + '…' + address.slice(-4) : 'Connect Wallet';
    get('wallet-title').textContent = address ? 'Connected wallet' : 'Connect Wallet';
    get('wallet-status').textContent = error || (address ? address.slice(0, 4) + '…' + address.slice(-4) : '');
    get('wallet-status').title = address;
    get('wallet-prompt').hidden = Boolean(address);
    disconnect.hidden = !address;
    disconnect.disabled = busy;
    action.hidden = Boolean(address);
    dialog.classList.toggle('wallet-connected', Boolean(address));
    get('wallet-refresh').hidden = !address;
    get('wallet-view-history').hidden = !address;
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
    document.dispatchEvent(new CustomEvent('zetag:wallet-changed', { detail: { address } }));
    if (!address) {
      session?.unsubscribe?.();
      session = null;
    }
    renderWallet();
    refresh();
  }

  function openWallet() {
    renderWallet();
    dialog.showModal();
  }

  window.ZeTagWallet = Object.freeze({
    get address() { return address; },
    async signMessage(value) {
      const signer = address;
      if (!session || !signer) throw new Error('Connect your wallet first.');
      const bytes = await session.wallet.sign(new TextEncoder().encode(value), signer);
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
      updateAccount();
    } catch {
      renderWallet('Could not disconnect. Please try again.');
    } finally {
      busy = false;
      disconnect.disabled = false;
    }
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
        const pending = pendingForm;
        pendingForm = null;
        if (pending?.form.isConnected && dialog.open) {
          dialog.close();
          pending.form.requestSubmit(pending.submitter);
        }
      }
    } catch (error) {
      renderWallet(error?.code === 4001 ? 'Connection declined.' : 'Wallet request failed. Please try again.');
    } finally {
      busy = false;
      action.disabled = false;
    }
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

  async function loadBalance(owner, controller) {
    const status = get('wallet-balance-status');
    const balance = get('wallet-balance');
    const endpoints = [...new Set([rpcUrl, 'https://solana-rpc.publicnode.com'])];
    balance.textContent = 'Loading…';
    status.textContent = '';
    for (const endpoint of endpoints) {
      if (controller.signal.aborted) return null;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(6500)]);
        const result = await rpc('getTokenAccountsByOwner', [owner, { mint: usdc }, {
          encoding: 'jsonParsed', commitment: 'confirmed'
        }], signal, endpoint);
        const total = result.value.reduce((sum, item) =>
          sum + BigInt(item.account.data.parsed.info.tokenAmount.amount), 0n);
        if (controller.signal.aborted) return null;
        balance.textContent = format(total);
        return new Set(result.value.map(item => item.pubkey));
      } catch {
        if (controller.signal.aborted) return null;
      }
    }
    balance.textContent = 'Unavailable';
    status.textContent = 'Could not read the Solana balance. Use Refresh wallet data to retry.';
    return null;
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

  function openReceipt({ signature, blockTime }, amount, inbound) {
    const direction = inbound ? 'Received' : 'Sent';
    const date = blockTime ? new Date(blockTime * 1000) : null;
    const url = 'https://explorer.solana.com/tx/' + encodeURIComponent(signature);
    const receipt = get('receipt-dialog');
    const text = get('receipt-text');
    const feedback = get('receipt-feedback');
    get('receipt-amount').textContent = direction + ' ' + format(amount);
    get('receipt-date').textContent = date ? date.toLocaleString() : 'Date unavailable';
    get('receipt-link').href = url;
    text.value = ['Solana USDC transaction receipt', direction + ' ' + format(amount), date?.toISOString(), url].filter(Boolean).join('\n');
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
      get('wallet-balance-status').textContent = '';
      return;
    }
    status.textContent = 'Loading recent USDC activity…';
    balanceRequest = new AbortController();
    const accounts = await loadBalance(owner, balanceRequest);
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
          if (item.confirmationStatus === 'finalized' || item.confirmationStatus === 'confirmed') {
            const receiptButton = document.createElement('button');
            receiptButton.type = 'button';
            receiptButton.className = 'receipt-button';
            receiptButton.textContent = 'Receipt';
            receiptButton.onclick = () => openReceipt(item, amount, inbound);
            row.append(receiptButton);
          }
          list.append(row);
        });
      }
      if (request !== controller) return;
      const scope = (accounts ? '' : 'Wallet address only. ') + 'Totals cover the latest ' + recent.length + ' candidate transactions from the wallet and up to four current USDC accounts.';
      status.textContent = missing ? 'Some transaction data was unavailable. Refresh to retry.' : scope;
      if (!missing) {
        get('wallet-received').textContent = format(received);
        get('wallet-sent').textContent = format(sent);
      }
      historyStatus.textContent = missing ? status.textContent : list.children.length
        ? scope : 'No USDC balance changes found in the recent transactions checked.';
    } catch {
      if (request !== controller) return;
      status.textContent = historyStatus.textContent = 'Could not load transaction history. Try refreshing.';
    } finally {
      clearTimeout(timeout);
      if (request === controller && signal.aborted) status.textContent = historyStatus.textContent = 'Transaction history timed out. Try refreshing.';
    }
  }

  refresh();
})();
