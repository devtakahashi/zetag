'use strict';

(() => {
  const get = id => document.getElementById(id);
  const tags = /^[a-z0-9][a-z0-9_-]{2,23}$/;
  const presets = [
    ['zelle','Zelle'], ['paypal','PayPal'], ['solana','Solana'], ['pump-fun','Pump.fun'],
    ['coingecko','CoinGecko'], ['dex-screener','DEX Screener'],
    ['zetag-space-courier','ZeTag Space Courier'], ['zetag-after-hours','ZeTag After Hours']
  ];
  const publicTag = new URLSearchParams(location.search).get('tag');
  const viewingPublic = publicTag !== null;
  const { api: call, avatar: miniAvatar, badge, fmtTime, emojiPicker } = window.ZeTagUI;
  const editor = get('profile-editor');
  const ping = get('ping-dialog');
  const status = get('profile-status');
  const editStatus = get('profile-editor-status');
  const input = get('profile-tag');
  const bio = get('profile-bio-input');
  const picker = get('avatar-options');
  const upload = get('avatar-upload');
  const save = get('profile-save');
  const pingForm = get('ping-form');
  let current;
  let avatar = '';
  let generation = 0;
  let uploadId = 0;
  let uploading = false;
  let saving = false;
  let signingIn = false;
  let peer;
  let pingGeneration = 0;
  let pingTimer = null;
  let pingBusy = false;

  const cleanTag = value => value.trim().toLowerCase().replace(/^@/, '');
  function avatarSource(value) {
    if (presets.some(([key]) => key === value)) return '../assets/avatars/' + value + '.webp';
    return typeof value === 'string' && value.length <= 8000 &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
  }

  function draw(photo, initials, value, tag) {
    const source = avatarSource(value);
    photo.hidden = !source;
    initials.hidden = Boolean(source);
    initials.textContent = tag ? tag.replace(/[_-]/g, '').slice(0, 2).toUpperCase() : '@';
    photo.onerror = () => { photo.hidden = true; initials.hidden = false; };
    if (source && photo.getAttribute('src') !== source) photo.src = source;
    if (!source) photo.removeAttribute('src');
  }

  function preview() {
    draw(get('editor-avatar'), get('editor-initials'), avatar, cleanTag(input.value));
    for (const button of picker.children) button.setAttribute('aria-pressed', String(button.value === avatar));
  }

  function setDisabled() {
    save.disabled = saving || uploading;
    input.disabled = bio.disabled = upload.disabled = get('avatar-reset').disabled = saving;
    for (const button of [...picker.children, ...get('profile-emojis').querySelectorAll('button')]) button.disabled = saving;
  }

  function setAvatar(value) {
    uploadId++;
    uploading = false;
    upload.value = '';
    avatar = value;
    editStatus.textContent = '';
    setDisabled();
    preview();
  }

  for (const [key, name] of presets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.value = key;
    button.setAttribute('aria-label', name);
    button.title = name;
    const image = document.createElement('img');
    image.src = avatarSource(key);
    image.alt = '';
    image.width = image.height = 96;
    button.append(image);
    picker.append(button);
    button.onclick = () => setAvatar(key);
  }
  emojiPicker(get('profile-emojis'), bio);

  input.oninput = preview;
  get('avatar-reset').onclick = () => setAvatar(presets[crypto.getRandomValues(new Uint32Array(1))[0] % presets.length][0]);
  const finder = get('profile-find-tag');
  const suggestions = get('tag-suggestions');
  let searchTimer, searchRequest;
  let activeSuggestion = -1;
  function closeSuggestions() {
    clearTimeout(searchTimer);
    searchRequest?.abort();
    activeSuggestion = -1;
    suggestions.hidden = true;
    finder.setAttribute('aria-expanded', 'false');
    finder.removeAttribute('aria-activedescendant');
  }

  function find(tag) {
    if (!tags.test(tag)) { status.textContent = 'Enter a valid ZeTag.'; return; }
    location.href = './?tag=' + encodeURIComponent(tag);
  }

  finder.addEventListener('input', () => {
    closeSuggestions();
    const query = cleanTag(finder.value);
    if (!/^[a-z0-9][a-z0-9_-]{1,23}$/.test(query)) return;
    const controller = new AbortController();
    searchRequest = controller;
    searchTimer = setTimeout(async () => {
      try {
        const data = await call('/_search?q=' + encodeURIComponent(query), null,
          AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]));
        if (controller.signal.aborted) return;
        suggestions.replaceChildren(...data.matches.map((match, i) => {
          const option = document.createElement('li');
          option.id = 'tag-option-' + i;
          option.setAttribute('role', 'option');
          option.setAttribute('aria-selected', 'false');
          option.dataset.tag = match.tag;
          option.append(miniAvatar(match), '@' + match.tag);
          option.addEventListener('mousedown', event => event.preventDefault());
          option.onclick = () => find(match.tag);
          return option;
        }));
        suggestions.hidden = !suggestions.children.length;
        finder.setAttribute('aria-expanded', String(!suggestions.hidden));
      } catch {}
    }, 180);
  });

  finder.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSuggestions(); return; }
    if (suggestions.hidden) return;
    const size = suggestions.children.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      activeSuggestion = activeSuggestion < 0 ? (event.key === 'ArrowDown' ? 0 : size - 1)
        : (activeSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + size) % size;
      for (const [i, option] of Array.from(suggestions.children).entries()) {
        option.setAttribute('aria-selected', String(i === activeSuggestion));
      }
      finder.setAttribute('aria-activedescendant', suggestions.children[activeSuggestion].id);
    }
  });
  finder.addEventListener('blur', closeSuggestions);
  get('profile-search').onsubmit = event => {
    event.preventDefault();
    find(activeSuggestion >= 0 ? suggestions.children[activeSuggestion].dataset.tag : cleanTag(finder.value));
  };

  const publicUrl = tag => new URL('./?tag=' + encodeURIComponent(tag), location.href).href;
  get('profile-copy').onclick = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(publicUrl(current.tag));
      status.textContent = 'Profile link copied.';
    } catch {
      location.href = publicUrl(current.tag);
    }
  };

  function show(profile) {
    current = profile;
    const mine = !viewingPublic && Boolean(profile);
    get('profile-title').textContent = profile ? '@' + profile.tag : 'Your ZeTag';
    get('profile-bio').textContent = profile?.bio ?? '';
    get('profile-bio').hidden = !profile?.bio;
    get('profile-add-bio').hidden = !mine || Boolean(profile?.bio);
    get('profile-joined').textContent = profile ? 'Joined ' + new Intl.DateTimeFormat('en', {
      month: 'short', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(profile.joinedAt)) : '';
    get('profile-joined').hidden = !profile;
    get('profile-copy').hidden = !profile;
    get('profile-edit').hidden = !mine;
    get('profile-activity').hidden = !mine;
    get('profile-public').hidden = !mine;
    get('profile-pay').hidden = !profile;
    get('profile-ping').hidden = !profile;
    for (const id of ['profile-pay','profile-ping']) get(id).classList.toggle('owner-compact-action', mine);
    if (profile) {
      get('profile-public').href = publicUrl(profile.tag);
    }
    draw(get('profile-avatar'), get('profile-initials'), profile?.avatar ?? '', profile?.tag ?? '');
    const address = window.ZeTagWallet?.address;
    if (mine && address) {
      document.dispatchEvent(new CustomEvent('zetag:wallet-profile', { detail: { owner: address, profile } }));
    }
  }

  function promptOwner(text, connected) {
    get('profile-connect').hidden = false;
    get('profile-connect').textContent = connected ? 'Sign in with wallet' : 'Connect wallet';
    status.textContent = text;
  }

  async function load(address = window.ZeTagWallet?.address) {
    const id = ++generation;
    get('profile-connect').hidden = true;
    get('profile-claim').hidden = true;
    status.textContent = 'Loading profile…';
    if (viewingPublic && !tags.test(publicTag)) { status.textContent = 'Enter a valid ZeTag.'; return; }
    try {
      if (viewingPublic) {
        const profile = await call('/' + publicTag);
        if (id !== generation) return;
        show(profile);
        status.textContent = '';
        return;
      }
      const data = await call('/_me');
      if (id !== generation) return;
      if (address && data.wallet !== address) {
        show(null);
        promptOwner('Sign in to open the profile for this wallet.', true);
        return;
      }
      show(data.profile);
      if (data.profile) {
        status.textContent = '';
      } else {
        get('profile-claim').hidden = false;
        status.textContent = 'Choose a tag and avatar to create your profile.';
      }
    } catch (error) {
      if (id !== generation) return;
      show(null);
      if (!viewingPublic && error.status === 401) {
        promptOwner(address ? 'Sign a message to open your profile or claim a tag.' : 'Connect your wallet to open your profile.', Boolean(address));
      } else status.textContent = error.message;
    }
  }

  async function signIn() {
    const wallet = window.ZeTagWallet;
    if (!wallet?.address) {
      get('wallet-button').click();
      return null;
    }
    if (signingIn) return null;
    const address = wallet.address;
    signingIn = true;
    try {
      const challenge = await call('/login/challenge', { wallet: address });
      if (wallet.address !== address) return null;
      const signature = await wallet.signMessage(challenge.message, { endpoint: '/pay/_profiles/login', nonce: challenge.nonce });
      const signed = await call('/login', { nonce: challenge.nonce, signature });
      document.dispatchEvent(new Event('zetag:profile-session'));
      return signed;
    } finally {
      signingIn = false;
    }
  }

  get('profile-connect').onclick = async () => {
    try {
      if (await signIn()) await load();
    } catch (error) { status.textContent = error.message; }
  };

  function openEditor(focusBio = false) {
    if (!window.ZeTagWallet?.address) {
      get('wallet-button').click();
      return;
    }
    if (saving) return;
    input.value = current ? '@' + current.tag : '';
    bio.value = current?.bio ?? '';
    setAvatar(current?.avatar ?? '');
    get('editor-title').textContent = current ? 'Edit profile' : 'Claim your ZeTag';
    save.textContent = current ? 'Save changes' : 'Claim @tag';
    editor.showModal();
    if (focusBio) bio.focus();
  }
  get('profile-edit').onclick = () => openEditor();
  get('profile-claim').onclick = () => openEditor();
  get('profile-add-bio').onclick = () => openEditor(true);
  editor.addEventListener('close', () => {
    uploadId++;
    uploading = false;
    setDisabled();
  });

  upload.onchange = async () => {
    const file = upload.files[0];
    if (!file) return;
    const id = ++uploadId;
    uploading = true;
    setDisabled();
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
        throw new Error('Choose a PNG, JPG, or WebP under 8 MB.');
      }
      const bitmap = await createImageBitmap(file);
      let result = '';
      try {
        const canvas = document.createElement('canvas');
        const ink = canvas.getContext('2d');
        const side = Math.min(bitmap.width, bitmap.height);
        for (const size of [96, 72, 48]) {
          canvas.width = canvas.height = size;
          ink.fillStyle = '#3d2860';
          ink.fillRect(0, 0, size, size);
          ink.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
          result = canvas.toDataURL('image/jpeg', .74);
          if (avatarSource(result)) break;
        }
      } finally { bitmap.close(); }
      if (id !== uploadId) return;
      if (!avatarSource(result)) throw new Error('Could not prepare this photo.');
      avatar = result;
      editStatus.textContent = '';
      preview();
    } catch (error) {
      if (id === uploadId) editStatus.textContent = error.message;
    } finally {
      if (id === uploadId) {
        uploading = false;
        upload.value = '';
        setDisabled();
      }
    }
  };

  get('profile-form').onsubmit = async event => {
    event.preventDefault();
    if (saving || uploading) return;
    const wallet = window.ZeTagWallet;
    const address = wallet?.address;
    const tag = cleanTag(input.value);
    if (!address || !tags.test(tag)) { editStatus.textContent = 'Use 3–24 letters, numbers, underscores, or hyphens.'; return; }
    saving = true;
    const id = generation;
    setDisabled();
    try {
      editStatus.textContent = 'Preparing your profile…';
      const challenge = await call('/challenge', { wallet: address, tag, avatar, bio: bio.value.trim() });
      if (wallet.address !== address) return;
      editStatus.textContent = 'Approve the profile signature in your wallet.';
      const signature = await wallet.signMessage(challenge.message, { endpoint: '/pay/_profiles', nonce: challenge.nonce });
      const result = await call('', { nonce: challenge.nonce, signature });
      if (id !== generation) return;
      show(result.profile);
      document.dispatchEvent(new Event('zetag:profile-session'));
      get('profile-claim').hidden = true;
      if (editor.open) editor.close();
      status.textContent = 'Profile saved.';
    } catch (error) {
      if (id === generation) editStatus.textContent = error.message;
    } finally {
      saving = false;
      setDisabled();
    }
  };

  for (const tab of document.querySelectorAll('[data-activity]')) tab.onclick = () => {
    for (const item of document.querySelectorAll('[data-activity]')) item.setAttribute('aria-pressed', String(item === tab));
    get('activity-empty').textContent = {
      sent: 'No tagged payments sent yet.',
      received: 'No tagged payments received yet.',
      withdrawn: 'No withdrawals yet.'
    }[tab.dataset.activity];
  };

  function stopPolling() { clearInterval(pingTimer); pingTimer = null; }

  const pingList = get('ping-list');
  let markedThrough = 0;
  let lastRender = '';
  let fetching = false;

  async function refreshPing(id, tag) {
    if (fetching || document.hidden) return;
    fetching = true;
    try {
      const data = await call('/_ping' + (tag ? '/' + tag : ''));
      if (id !== pingGeneration || !ping.open) return;
      showMessages(data, tag);
      const bounds = pingList.getBoundingClientRect();
      const visible = [...pingList.querySelectorAll('[data-incoming]')].findLast(row => {
        const rect = row.getBoundingClientRect();
        return rect.top < bounds.bottom && rect.bottom > bounds.top;
      });
      const through = Number(visible?.dataset.incoming ?? 0);
      if (through > markedThrough && document.hasFocus()) {
        await call('/_ping/' + tag + '/read', { through });
        if (id !== pingGeneration) return;
        markedThrough = through;
        document.dispatchEvent(new Event('zetag:ping-updated'));
      }
    } finally {
      if (id === pingGeneration) fetching = false;
    }
  }

  async function openPing(tag) {
    stopPolling();
    const id = ++pingGeneration;
    fetching = false;
    markedThrough = 0;
    lastRender = '';
    peer = tag;
    pingList.replaceChildren();
    pingList.classList.toggle('ping-thread', Boolean(tag));
    get('ping-message').value = '';
    pingForm.hidden = true;
    get('ping-back').hidden = !tag;
    get('ping-peer-avatar').hidden = true;
    get('ping-total').hidden = true;
    get('ping-title').textContent = tag ? '@' + tag : 'Ping inbox';
    get('ping-status').textContent = 'Loading…';
    if (!ping.open) ping.showModal();
    try {
      try { await refreshPing(id, tag); }
      catch (error) {
        if (error.status !== 401 || id !== pingGeneration) throw error;
        if (!window.ZeTagWallet?.address) throw new Error('Connect your wallet to open Ping.');
        const signed = await signIn();
        if (!signed || id !== pingGeneration) return;
        await refreshPing(id, tag);
      }
      if (id !== pingGeneration) return;
      pingTimer = setInterval(() => { void refreshPing(id, tag).catch(() => {}); }, 5000);
    } catch (error) {
      if (id !== pingGeneration) return;
      get('ping-status').textContent = error.message;
      if (!window.ZeTagWallet?.address && error.status !== 403) {
        const connect = document.createElement('button');
        connect.type = 'button';
        connect.className = 'text-action';
        connect.textContent = 'Connect wallet';
        connect.onclick = () => { ping.close(); get('wallet-button').click(); };
        get('ping-status').append(' ', connect);
      }
    }
  }

  function timestamp(value) {
    const time = document.createElement('time');
    if (value) time.dateTime = value;
    time.textContent = fmtTime(value);
    return time;
  }

  function showMessages(data, tag) {
    if (!tag) {
      badge(get('ping-total'), data.unread);
      if (!Array.isArray(data.threads)) throw new Error('The Ping update is still deploying. Try again shortly.');
      const key = JSON.stringify(data.threads);
      if (key === lastRender) return;
      lastRender = key;
      pingList.replaceChildren(...data.threads.map(contact => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        const text = document.createElement('span');
        const headline = document.createElement('span');
        const name = document.createElement('strong');
        const count = document.createElement('span');
        const preview = document.createElement('small');
        button.type = 'button';
        button.className = 'ping-contact';
        text.className = 'ping-contact-text';
        headline.className = 'ping-contact-headline';
        name.textContent = '@' + contact.tag;
        count.className = 'count-badge';
        badge(count, contact.unread);
        headline.append(name, count);
        preview.textContent = contact.preview;
        text.append(headline, preview);
        button.append(miniAvatar(contact, 'avatar-contact'), text, timestamp(contact.sentAt));
        button.onclick = () => openPing(contact.tag);
        li.append(button);
        return li;
      }));
      get('ping-status').textContent = data.threads.length ? '' : 'Find a ZeTag to send your first ping.';
      return;
    }
    const key = JSON.stringify(data);
    if (key === lastRender) return;
    lastRender = key;
    get('ping-title').textContent = '@' + data.peer.tag;
    get('ping-peer-avatar').replaceChildren(miniAvatar(data.peer, 'avatar-contact'));
    get('ping-peer-avatar').hidden = false;
    const nearBottom = pingList.scrollHeight - pingList.scrollTop - pingList.clientHeight < 60;
    pingList.replaceChildren(...data.messages.map(message => {
      const li = document.createElement('li');
      li.className = 'ping-message ' + (message.mine ? 'is-outgoing' : 'is-incoming');
      if (!message.mine) li.dataset.incoming = String(message.id);
      const content = document.createElement('div');
      const body = document.createElement('p');
      const meta = document.createElement('span');
      body.className = 'ping-bubble';
      body.textContent = message.body;
      meta.className = 'ping-message-meta';
      meta.append(timestamp(message.sentAt));
      if (message.mine) {
        const tick = document.createElement('span');
        tick.className = message.read ? 'ping-tick is-read' : 'ping-tick';
        tick.textContent = message.read ? '✓✓' : '✓';
        tick.setAttribute('role','img');
        tick.setAttribute('aria-label', message.read ? 'Read' : 'Delivered');
        meta.append(tick);
      }
      content.append(body, meta);
      li.append(miniAvatar(message.mine ? data.owner : data.peer), content);
      return li;
    }));
    if (nearBottom) pingList.scrollTop = pingList.scrollHeight;
    pingForm.hidden = false;
    get('ping-status').textContent = data.messages.length ? '' : 'Send the first ping.';
  }

  get('profile-ping').onclick = () => { if (current) openPing(viewingPublic ? current.tag : null); };
  get('ping-inbox').onclick = () => openPing(null);
  get('ping-back').onclick = () => openPing(null);
  pingList.addEventListener('scrollend', () => {
    if (peer && ping.open) void refreshPing(pingGeneration, peer).catch(() => {});
  });
  ping.addEventListener('close', () => { ++pingGeneration; stopPolling(); });
  pingForm.onsubmit = async event => {
    event.preventDefault();
    if (!peer || pingBusy) return;
    const message = get('ping-message');
    const id = pingGeneration;
    const tag = peer;
    const body = message.value.trim();
    if (!body) return;
    pingBusy = true;
    message.disabled = true;
    get('ping-status').textContent = 'Sending…';
    try {
      await call('/_ping/' + tag, { body });
      if (id !== pingGeneration) return;
      message.value = '';
      get('ping-status').textContent = '';
      await refreshPing(id, tag);
    } catch (error) {
      if (id === pingGeneration) get('ping-status').textContent = error.message;
    } finally {
      pingBusy = false;
      message.disabled = false;
      if (id === pingGeneration) message.focus();
    }
  };

  const pay = get('zepay-dialog');
  const payForm = get('zepay-form');
  const payStatus = get('zepay-status');
  const payAmount = get('zepay-amount');
  const payNote = get('zepay-note');
  const emojiToggle = get('zepay-emoji-toggle');
  const payEmoji = get('zepay-emojis');
  emojiPicker(payEmoji, payNote);
  emojiToggle.onclick = () => {
    payEmoji.hidden = !payEmoji.hidden;
    emojiToggle.setAttribute('aria-expanded', String(!payEmoji.hidden));
  };
  function showBalance() {
    const wallet = window.ZeTagWallet;
    get('zepay-available').textContent = !wallet?.address ? 'Connect a wallet to see your balance.'
      : wallet.balanceText ? 'Available ' + wallet.balanceText : 'Available balance could not be verified.';
  }
  document.addEventListener('zetag:wallet-balance', showBalance);
  document.addEventListener('zetag:asset-changed', () => {
    showBalance();
    payStatus.textContent = '';
    if (pay.open && !payForm.hidden) return;
    if (pay.open) get('zepay-back').click();
  });
  get('profile-pay').onclick = () => {
    if (!viewingPublic) { finder.focus(); return; }
    if (!current) return;
    payForm.reset();
    payEmoji.hidden = true;
    emojiToggle.setAttribute('aria-expanded', 'false');
    get('zepay-avatar').replaceChildren(miniAvatar(current, 'avatar-contact'));
    get('zepay-recipient').textContent = '@' + current.tag;
    payStatus.textContent = '';
    showBalance();
    get('zepay-back').click();
    pay.showModal();
  };
  get('zepay-back').onclick = () => {
    get('zepay-review').hidden = true;
    payForm.hidden = false;
    if (pay.open) payAmount.focus();
  };
  payForm.onsubmit = event => {
    event.preventDefault();
    const amount = payAmount.value.trim();
    if (!ZeTagTokens.normalize(amount, ZeTagTokens.selected)) {
      payStatus.textContent = 'Enter a positive ' + ZeTagTokens.selected + ' amount with up to ' + ZeTagTokens.assets[ZeTagTokens.selected].decimals + ' decimal places.';
      return;
    }
    const units = ZeTagTokens.units(amount);
    const balance = window.ZeTagWallet?.balance;
    if (balance !== null && balance !== undefined && units > balance) {
      payStatus.textContent = 'This amount exceeds your available balance.';
      return;
    }
    const purpose = new FormData(payForm).get('purpose');
    const note = payNote.value.trim();
    get('zepay-summary').textContent = amount + ' ' + ZeTagTokens.selected + ' to @' + current.tag + (purpose ? ' · ' + purpose : '') + (note ? ' · ' + note : '');
    payForm.hidden = true;
    get('zepay-review').hidden = false;
    get('zepay-back').focus();
  };

  document.addEventListener('zetag:wallet-changed', event => {
    if (ping.open) ping.close();
    if (viewingPublic) return;
    const walletDialog = get('wallet-dialog');
    if (event.detail.address && walletDialog.open) walletDialog.close();
    if (editor.open) editor.close();
    load(event.detail.address);
  });
  document.addEventListener('zetag:wallet-signed-out', () => {
    if (ping.open) ping.close();
    if (viewingPublic) return;
    ++generation;
    show(null);
    get('profile-claim').hidden = true;
    promptOwner('Connect your wallet to open your profile.', false);
  });
  load();
  if (new URLSearchParams(location.search).get('ping') === 'inbox') {
    window.addEventListener('load', () => { void openPing(null); }, { once: true });
  }
})();
