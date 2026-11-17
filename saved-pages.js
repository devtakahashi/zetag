'use strict';

const ZeTagSaved = (() => {
  function storage(kind, key, value) {
    try {
      const store = window[kind];
      if (value !== undefined) { store.setItem(key, value); return true; }
      return store.getItem(key);
    } catch { return value === undefined ? null : false; }
  }

  function walletPage(address, url) {
    if (!address) return null;
    const key = 'zetag:page:' + address;
    if (url) return storage('localStorage', key, url.href);
    const stored = storage('localStorage', key);
    return validCheckout(stored);
  }

  function validCheckout(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.origin !== location.origin || !/\/pay\/(?:[a-z0-9_.-]+)?$/.test(url.pathname)) return null;
      return url;
    } catch { return null; }
  }

  function setRecent(url) {
    return Boolean(validCheckout(url.href) && storage('sessionStorage', 'zetag:recent-checkout', url.href));
  }

  function getRecent() {
    return validCheckout(storage('sessionStorage', 'zetag:recent-checkout'));
  }

  function refreshRecentButton() {
    const button = document.querySelector('#recent-checkout');
    if (!button) return;
    const recent = getRecent();
    button.hidden = !recent;
    if (recent) button.href = recent.href;
  }
  window.addEventListener('pageshow', refreshRecentButton);
  refreshRecentButton();

  return Object.freeze({ walletPage, setRecent, getRecent });
})();
