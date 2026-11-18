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
  const api = new URL('../pay/_profiles', location.href);
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
    for (const button of [...picker.children, ...get('profile-emojis').children]) button.disabled = saving;
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
  for (const [emoji, name] of [['☕','coffee'],['✨','sparkles'],['💜','purple heart'],['🚀','rocket'],['🙌','raised hands'],['😊','smile']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = emoji;
    button.setAttribute('aria-label', 'Add ' + name + ' emoji');
    button.onclick = () => {
      const start = bio.selectionStart;
      const end = bio.selectionEnd;
      if (bio.value.length - (end - start) + emoji.length > 120) return;
      bio.setRangeText(emoji, start, end, 'end');
      bio.focus();
    };
    get('profile-emojis').append(button);
  }

  input.oninput = preview;
  get('avatar-reset').onclick = () => setAvatar('');
  get('profile-search').onsubmit = event => {
    event.preventDefault();
    const tag = cleanTag(get('profile-find-tag').value);
    if (!tags.test(tag)) { status.textContent = 'Enter a valid ZeTag.'; return; }
    location.href = './?tag=' + encodeURIComponent(tag);
  };

  async function call(path, payload) {
    const response = await fetch(api.href + path, {
      ...(payload ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      } : {}),
      signal: AbortSignal.timeout(12000),
      cache: 'no-store'
    });
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Could not reach the profile service.');
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Profile service unavailable.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

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
    get('profile-pay').hidden = !viewingPublic || !profile;
    get('profile-ping').hidden = !viewingPublic || !profile;
    if (profile) {
      get('profile-public').href = publicUrl(profile.tag);
      get('profile-pay').href = '../?tag=' + encodeURIComponent(profile.tag);
    }
    draw(get('profile-avatar'), get('profile-initials'), profile?.avatar ?? '', profile?.tag ?? '');
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
      const signature = await wallet.signMessage(challenge.message);
      return await call('/login', { nonce: challenge.nonce, signature });
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
      const signature = await wallet.signMessage(challenge.message);
      const result = await call('', { nonce: challenge.nonce, signature });
      if (id !== generation) return;
      show(result.profile);
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
  async function openPing(tag) {
    stopPolling();
    const id = ++pingGeneration;
    peer = tag;
    const list = get('ping-list');
    list.replaceChildren();
    get('ping-message').value = '';
    pingForm.hidden = true;
    get('ping-title').textContent = tag ? 'Ping @' + tag : 'Ping inbox';
    get('ping-status').textContent = 'Loading…';
    if (!ping.open) ping.showModal();
    try {
      let info;
      try {
        const address = window.ZeTagWallet?.address;
        if (address) {
          const signed = await call('/_me');
          if (signed.wallet !== address) throw Object.assign(new Error(), { status: 401 });
        }
        if (id !== pingGeneration) return;
        info = await call('/_ping' + (tag ? '/' + tag : ''));
      }
      catch (error) {
        if (error.status !== 401) throw error;
        if (!window.ZeTagWallet?.address) throw new Error('Connect your wallet, then open Ping again.');
        const signed = await signIn();
        if (!signed || id !== pingGeneration) return;
        info = await call('/_ping' + (tag ? '/' + tag : ''));
      }
      if (id !== pingGeneration) return;
      showMessages(info);
      pingTimer = setInterval(async () => {
        try {
          const fresh = await call('/_ping' + (tag ? '/' + tag : ''));
          if (id === pingGeneration) showMessages(fresh);
        } catch {}
      }, 6000);
    } catch (error) {
      if (id === pingGeneration) get('ping-status').textContent = error.message;
    }
  }

  function showMessages(data) {
    const list = get('ping-list');
    if (data.contacts) {
      list.replaceChildren(...data.contacts.map(tag => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-action';
        button.textContent = '@' + tag;
        button.onclick = () => openPing(tag);
        li.append(button);
        return li;
      }));
      get('ping-status').textContent = data.contacts.length ? '' : 'No conversations yet. Find a ZeTag to send a ping.';
      return;
    }
    const next = data.messages.at(-1)?.id;
    if (list.dataset.last !== String(next) || !list.children.length) {
      list.replaceChildren(...data.messages.map(message => {
        const li = document.createElement('li');
        li.className = message.mine ? 'ping-mine' : 'ping-theirs';
        li.textContent = message.body;
        li.title = new Date(message.sentAt).toLocaleString();
        return li;
      }));
      list.dataset.last = String(next);
      list.scrollTop = list.scrollHeight;
    }
    pingForm.hidden = false;
    get('ping-status').textContent = data.messages.length ? '' : 'Send the first ping.';
  }

  get('profile-ping').onclick = () => { if (current) openPing(current.tag); };
  get('ping-inbox').onclick = () => openPing(null);
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
    get('ping-status').textContent = 'Sending…';
    try {
      await call('/_ping/' + tag, { body });
      if (id !== pingGeneration) return;
      message.value = '';
      const data = await call('/_ping/' + tag);
      if (id === pingGeneration) showMessages(data);
    } catch (error) {
      if (id === pingGeneration) get('ping-status').textContent = error.message;
    } finally {
      pingBusy = false;
    }
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
})();
