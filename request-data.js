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

  function initials(value) {
    const words = value.match(/[\p{L}\p{N}]+/gu) ?? [];
    const first = Array.from(words[0] ?? '');
    if (!first.length) return '';
    if (words.length > 1) return (first[0] + Array.from(words[1])[0]).toUpperCase();
    const consonants = first.filter(letter => /[b-df-hj-np-tv-z]/i.test(letter));
    const pool = consonants.length >= 2 ? consonants : first;
    const rest = pool[0] === first[0] ? pool.slice(1) : pool;
    return (first[0] + (rest[Math.floor(rest.length / 2)] ?? '')).toUpperCase();
  }

  function branding(input) {
    let logo = '';
    const raw = input.logo;
    if (typeof raw === 'string' && raw.length <= 1450 &&
        /^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      logo = raw;
    } else {
      try {
        const url = new URL(raw);
        if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 300) logo = url.href;
      } catch {}
    }
    return { logo };
  }

  function applyBranding(group, input) {
    const { logo } = branding(input);
    const avatar = group.querySelector('img');
    const badge = group.querySelector('.badge-initials');
    const wallet = group.querySelector('.wallet-icon');
    const letters = initials(input.name || input.tag || '');
    function showFallback() {
      avatar.hidden = true;
      badge.hidden = !letters;
      wallet.hidden = Boolean(letters);
    }
    badge.textContent = letters;
    showFallback();
    avatar.onerror = showFallback;
    if (logo) {
      avatar.hidden = false;
      badge.hidden = wallet.hidden = true;
      avatar.src = logo;
    } else avatar.removeAttribute('src');
    group.hidden = false;
  }

  return Object.freeze({ tagPattern, normalizeAmount, formatAmount, validate, branding, initials, applyBranding });
})();
