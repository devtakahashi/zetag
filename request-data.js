'use strict';

const ZeTagRequest = (() => {
  const tagPattern = /^[a-z0-9][a-z0-9_-]{2,23}$/;
  const amountPattern = /^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$/;

  function normalizeAmount(value) {
    const input = String(value ?? '').trim();
    if (!amountPattern.test(input)) return '';
    const normalized = input.replaceAll(',', '');
    return /[1-9]/.test(normalized) ? normalized : '';
  }

  function formatAmount(value) {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole).toLocaleString('en-US') + '.' + fraction.padEnd(2, '0');
  }

  function validate(input) {
    if (!input || typeof input !== 'object') return null;
    const { tag, amount, name, note = '' } = input;
    if (typeof tag !== 'string' || !tagPattern.test(tag) ||
        typeof amount !== 'string' || normalizeAmount(amount) !== amount ||
        typeof name !== 'string' || !name.trim() || name.length > 50 ||
        typeof note !== 'string' || note.length > 100) return null;
    return { tag, amount, name, note };
  }

  const accents = new Set(['violet', 'mint', 'blue', 'rose']);
  function branding(input) {
    let logo = '';
    try {
      const url = new URL(input.logo);
      if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 300) logo = url.href;
    } catch {}
    return { logo, accent: accents.has(input.accent) ? input.accent : 'violet' };
  }

  function applyBranding(card, avatar, initials, input) {
    const { logo, accent } = branding(input);
    card.dataset.accent = accent;
    avatar.hidden = !logo;
    if (logo) avatar.src = logo;
    else avatar.removeAttribute('src');
    avatar.onerror = () => { avatar.hidden = true; initials.hidden = false; };
    initials.hidden = Boolean(logo);
    initials.textContent = input.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
  }

  return Object.freeze({ tagPattern, normalizeAmount, formatAmount, validate, branding, applyBranding });
})();
