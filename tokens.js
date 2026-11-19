'use strict';

(() => {
  const assets = Object.freeze({
    USDC: Object.freeze({ symbol: 'USDC', name: 'USD Coin', decimals: 6 }),
    SOL: Object.freeze({ symbol: 'SOL', name: 'Solana', decimals: 9 })
  });
  let selected = 'USDC';
  try {
    const saved = localStorage.getItem('zetag:asset');
    if (Object.hasOwn(assets, saved)) selected = saved;
  } catch {}

  function normalize(value, symbol = 'USDC') {
    if (!Object.hasOwn(assets, symbol)) return '';
    const input = String(value ?? '').trim();
    if (input.length > 40 || !new RegExp('^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\\.[0-9]{1,' + assets[symbol].decimals + '})?$').test(input)) return '';
    const result = input.replaceAll(',', '');
    return /[1-9]/.test(result) ? result : '';
  }

  function units(value, symbol = selected) {
    const amount = normalize(value, symbol);
    if (!amount) return null;
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole + fraction.padEnd(assets[symbol].decimals, '0'));
  }

  function formatUnits(value, symbol = selected) {
    const decimals = assets[symbol].decimals;
    const negative = value < 0n;
    const raw = (negative ? -value : value).toString().padStart(decimals + 1, '0');
    const whole = raw.slice(0, -decimals);
    const fraction = raw.slice(-decimals).replace(/0+$/, '').padEnd(2, '0');
    return (negative ? '−' : '') + BigInt(whole).toLocaleString('en-US') + '.' + fraction;
  }

  function formatAmount(value, symbol = 'USDC') {
    const amount = units(value, symbol);
    return amount === null ? '' : formatUnits(amount, symbol);
  }

  function mark(symbol) {
    const icon = document.createElement('span');
    icon.className = 'token-mark token-' + symbol.toLowerCase();
    icon.setAttribute('aria-hidden', 'true');
    if (symbol === 'USDC') icon.textContent = '$';
    else for (let i = 0; i < 3; i++) icon.append(document.createElement('i'));
    return icon;
  }

  function render() {
    for (const button of document.querySelectorAll('[data-asset-picker]')) {
      const symbol = button.dataset.fixedAsset || selected;
      const label = document.createElement('span');
      label.textContent = symbol;
      button.replaceChildren(mark(symbol), label);
      button.setAttribute('aria-label', button.disabled ? 'Payment token ' + symbol : 'Choose token, currently ' + symbol);
      if (!button.disabled) {
        const arrow = document.createElement('span');
        arrow.className = 'token-chevron';
        arrow.setAttribute('aria-hidden', 'true');
        button.append(arrow);
        button.setAttribute('aria-haspopup', 'dialog');
      }
    }
    for (const text of document.querySelectorAll('[data-asset-symbol]')) text.textContent = selected;
  }

  function select(symbol) {
    if (!Object.hasOwn(assets, symbol)) return;
    selected = symbol;
    try { localStorage.setItem('zetag:asset', symbol); } catch {}
    render();
    document.dispatchEvent(new CustomEvent('zetag:asset-changed', { detail: { asset: symbol } }));
  }

  const dialog = document.createElement('dialog');
  dialog.className = 'token-dialog';
  dialog.setAttribute('aria-labelledby', 'token-title');
  dialog.innerHTML = '<div class="dialog-heading"><h2 id="token-title">Choose a token</h2><form method="dialog"><button class="wallet-close" aria-label="Close token selection">×</button></form></div><div class="token-options"></div>';
  const options = dialog.querySelector('.token-options');
  for (const asset of Object.values(assets)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'token-option';
    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = asset.symbol;
    const full = document.createElement('small');
    full.textContent = asset.name;
    info.append(name, full);
    const balance = document.createElement('small');
    const check = document.createElement('span');
    check.className = 'token-check';
    check.setAttribute('aria-hidden', 'true');
    button.append(mark(asset.symbol), info, balance, check);
    button.onclick = () => { dialog.close(); select(asset.symbol); };
    button.dataset.symbol = asset.symbol;
    options.append(button);
  }
  document.body.append(dialog);
  function updateOptions() {
    for (const button of options.children) {
      const symbol = button.dataset.symbol;
      const balance = window.ZeTagWallet?.balanceOf?.(symbol);
      button.children[2].textContent = balance === null || balance === undefined ? '' : formatUnits(balance, symbol);
      button.children[3].textContent = '';
      button.setAttribute('aria-pressed', String(symbol === selected));
    }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-asset-picker]');
    if (!button || button.disabled) return;
    updateOptions();
    dialog.showModal();
  });
  document.addEventListener('zetag:wallet-balance', updateOptions);
  window.ZeTagTokens = Object.freeze({ assets, normalize, units, formatUnits, formatAmount, select, render, get selected() { return selected; } });
  render();
})();
