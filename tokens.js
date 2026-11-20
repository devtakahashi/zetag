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
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', String(button === activePicker));
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

  let activePicker = null;
  const menu = document.createElement('div');
  menu.id = 'token-menu';
  menu.className = 'token-dropdown';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Choose a token');
  function closeMenu(restoreFocus = false) {
    const previous = activePicker;
    menu.hidden = true;
    activePicker = null;
    previous?.setAttribute('aria-expanded', 'false');
    previous?.removeAttribute('aria-controls');
    if (restoreFocus && previous?.isConnected) previous.focus();
  }
  for (const asset of Object.values(assets)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'token-option';
    button.setAttribute('role', 'menuitemradio');
    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = asset.symbol;
    const full = document.createElement('small');
    full.textContent = asset.name;
    info.append(name, full);
    const check = document.createElement('span');
    check.className = 'token-check';
    check.setAttribute('aria-hidden', 'true');
    button.append(mark(asset.symbol), info, check);
    button.onclick = () => { closeMenu(true); select(asset.symbol); };
    button.dataset.symbol = asset.symbol;
    menu.append(button);
  }
  function updateOptions() {
    for (const button of menu.children) {
      const checked = String(button.dataset.symbol === selected);
      button.setAttribute('aria-checked', checked);
      button.setAttribute('aria-pressed', checked);
    }
  }
  function openMenu(button, last = false) {
    closeMenu();
    activePicker = button;
    button.parentElement.append(menu);
    updateOptions();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', menu.id);
    const current = [...menu.children].find(option => option.dataset.symbol === selected);
    (last ? menu.lastElementChild : current || menu.firstElementChild).focus();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-asset-picker]');
    if (button && !button.disabled) {
      if (activePicker === button) closeMenu();
      else openMenu(button);
    } else if (!menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    const picker = event.target.closest('[data-asset-picker]');
    if (picker && !picker.disabled && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      openMenu(picker, event.key === 'ArrowUp');
      return;
    }
    if (!activePicker) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (menu.contains(event.target) && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.children];
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    }
  });
  document.addEventListener('focusin', event => {
    if (activePicker && event.target !== activePicker && !menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('zetag:asset-changed', () => closeMenu());
  window.ZeTagTokens = Object.freeze({ assets, normalize, units, formatUnits, formatAmount, select, render, get selected() { return selected; } });
  render();
})();
