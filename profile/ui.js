'use strict';

(() => {
  const get = id => document.getElementById(id);
  const root = new URL('../', document.currentScript.src);
  const presets = new Set(['zelle','paypal','solana','pump-fun','coingecko','dex-screener','zetag-space-courier','zetag-after-hours']);
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtTime = value => value ? time.format(new Date(value)) : '';

  function avatar(profile, size = '') {
    const el = document.createElement('span');
    el.className = 'mini-avatar ' + size;
    const fallback = (profile?.tag ?? '@').slice(0, 2).toUpperCase();
    el.textContent = fallback;
    const value = profile?.avatar;
    const url = presets.has(value) ? new URL('assets/avatars/' + value + '.webp', root).href :
      typeof value === 'string' && value.length <= 8000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
        ? value : '';
    el.setAttribute('aria-hidden', 'true');
    if (url) {
      const img = document.createElement('img');
      img.alt = '';
      img.onerror = () => { el.textContent = fallback; };
      img.src = url;
      el.replaceChildren(img);
    }
    return el;
  }

  function badge(el, count) {
    el.hidden = !count;
    el.textContent = count > 99 ? '99+' : String(count);
    el.setAttribute('aria-label', count + ' unread');
  }

  async function api(path, payload, signal = AbortSignal.timeout(10000)) {
    const wallet = window.ZeTagWallet?.address;
    const response = await fetch(new URL('pay/_profiles' + path, root), {
      cache: 'no-store', signal,
      headers: {
        ...(wallet && { 'X-ZeTag-Wallet': wallet }),
        ...(payload && { 'Content-Type': 'application/json' })
      },
      ...(payload && { method: 'POST', body: JSON.stringify(payload) })
    });
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Could not reach the profile service.');
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Profile service unavailable.'), { status: response.status });
    return data;
  }

  const entries = {
    '🚀': ['Rocket','rocket'], '😎': ['Sunglasses','sunglasses'], '✨': ['Sparkles','sparkles'], '💜': ['Purple heart','purple-heart'],
    '☕': ['Coffee','coffee'], '💸': ['Money with wings','money-with-wings'], '🎁': ['Gift','gift'], '🎉': ['Party popper','party-popper'],
    '🔥': ['Fire','fire'], '🙌': ['Raised hands','raised-hands'], '😊': ['Smile','smile'], '😂': ['Tears of joy','tears-of-joy'],
    '🥳': ['Party face','party-face'], '🙏': ['Folded hands','folded-hands'], '💯': ['Hundred points','hundred'],
    '💰': ['Money bag','money-bag'], '💎': ['Gem','gem'], '🍔': ['Burger','burger'], '🚗': ['Car','car'], '💳': ['Credit card','credit-card']
  };
  const groups = {
    Favorites: '🚀 😎 ✨ 💜 ☕ 💸 🎁 🎉 🔥 🙌',
    Reactions: '😊 😂 🥳 😎 🙌 🙏 🔥 💜 💯 ✨',
    Payments: '💸 💰 💎 🎁 💳 ☕ 🍔 🚗'
  };

  function emojiPicker(container, field) {
    const tabs = document.createElement('div');
    const grid = document.createElement('div');
    tabs.className = 'emoji-tabs';
    grid.className = 'emoji-grid';
    for (const [name, values] of Object.entries(groups)) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.textContent = name;
      tab.onclick = () => {
        if (field.disabled) return;
        for (const button of tabs.children) button.setAttribute('aria-pressed', String(button === tab));
        grid.replaceChildren(...values.split(' ').map(value => {
          const [label, file] = entries[value];
          const button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('aria-label', 'Add ' + label + ' emoji');
          const img = document.createElement('img');
          img.alt = '';
          img.onerror = () => { button.textContent = value; };
          img.src = new URL('assets/emoji/' + file + '.webp', root);
          button.append(img);
          button.onclick = () => {
            if (field.disabled) return;
            const start = field.selectionStart;
            const end = field.selectionEnd;
            if (field.value.length - (end - start) + value.length > field.maxLength) return;
            field.setRangeText(value, start, end, 'end');
            field.focus();
          };
          return button;
        }));
      };
      tabs.append(tab);
    }
    container.replaceChildren(tabs, grid);
    tabs.firstElementChild.click();
  }

  const notifications = get('notifications-dialog');
  const bell = get('notifications-button');
  const mobile = get('mobile-wallet');
  const menu = mobile.closest('details');
  let owner = '';
  let pingUnread = 0;
  let contacts = [];
  let transactions = [];
  let seen = new Set();
  let revision = 0;
  let pending = false;

  const unreadTx = () => transactions.filter(tx => !seen.has(tx.signature));

  function update() {
    const tx = unreadTx();
    badge(bell.querySelector('.nav-count'), pingUnread + tx.length);
    bell.setAttribute('aria-label', 'Notifications' + (pingUnread + tx.length ? ', ' + (pingUnread + tx.length) + ' unread' : ''));
    badge(get('notifications-ping-count'), pingUnread);
    badge(get('notifications-transaction-count'), tx.length);
    const ping = contacts.find(contact => contact.unread);
    get('notifications-ping-preview').textContent = ping ? 'Ping from @' + ping.tag : 'Open inbox';
    get('notifications-transaction-preview').textContent = tx.length ? tx[0].amount + (tx[0].inbound ? ' received' : ' sent') : 'View USDC activity';
  }

  async function refreshProfile() {
    if (!owner || pending) return;
    const id = revision;
    pending = true;
    try {
      const data = await api('/_me');
      if (id !== revision || data.wallet !== owner) return;
      document.dispatchEvent(new CustomEvent('zetag:wallet-profile', { detail: { owner, profile: data.profile } }));
      if (!data.profile) return;
      const inbox = await api('/_ping');
      if (id !== revision) return;
      contacts = Array.isArray(inbox.threads) ? inbox.threads : [];
      pingUnread = Number(inbox.unread) || 0;
      update();
    } catch (error) {
      if (id === revision && (error.status === 401 || error.status === 403)) {
        pingUnread = 0;
        contacts = [];
        update();
      }
    } finally {
      if (id === revision) pending = false;
    }
  }

  document.addEventListener('zetag:wallet-changed', ({ detail }) => {
    owner = detail.address;
    ++revision;
    pending = false;
    pingUnread = 0;
    contacts = [];
    transactions = [];
    seen = new Set();
    if (owner) {
      try { seen = new Set(JSON.parse(localStorage.getItem('zetag:seen-tx:' + owner) ?? '[]')); } catch {}
    }
    mobile.textContent = owner ? 'Wallet' : 'Connect wallet';
    update();
    void refreshProfile();
  });
  document.addEventListener('zetag:profile-session', refreshProfile);
  document.addEventListener('zetag:ping-updated', refreshProfile);
  document.addEventListener('zetag:wallet-activity', ({ detail }) => {
    if (detail.owner !== owner) return;
    transactions = detail.transactions;
    update();
  });

  bell.onclick = () => {
    menu.open = false;
    const recent = get('recent-checkout');
    const reopen = get('notifications-recent');
    reopen.hidden = !recent || recent.hidden;
    if (!reopen.hidden) reopen.href = recent.href;
    notifications.showModal();
    void refreshProfile();
  };
  mobile.onclick = () => { menu.open = false; get('wallet-button').click(); };
  get('notifications-ping').onclick = () => {
    notifications.close();
    const inbox = get('ping-inbox');
    if (inbox) inbox.click();
    else location.href = new URL('profile/?ping=inbox', root);
  };
  get('notifications-transactions').onclick = () => {
    if (owner) {
      for (const tx of unreadTx()) seen.add(tx.signature);
      try { localStorage.setItem('zetag:seen-tx:' + owner, JSON.stringify([...seen].slice(-100))); } catch {}
      update();
    }
    notifications.close();
    get('history-button').click();
  };
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); }
  });
  setInterval(() => { if (!document.hidden) void refreshProfile(); }, 12000);

  window.ZeTagUI = Object.freeze({ api, avatar, badge, fmtTime, emojiPicker });
})();
