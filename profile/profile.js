'use strict';

(() => {
  const get = id => document.getElementById(id);
  const tags = /^[a-z0-9][a-z0-9_-]{2,23}$/;
  const presets = [
    ['zelle','Zelle'], ['paypal','PayPal'], ['solana','Solana'], ['pump-fun','Pump.fun'],
    ['coingecko','CoinGecko'], ['dex-screener','DEX Screener'],
    ['zetag-space-courier','ZeTag Space Courier'], ['zetag-after-hours','ZeTag After Hours']
  ];
  const form = get('profile-form');
  const input = get('profile-tag');
  const status = get('profile-status');
  const picker = get('avatar-options');
  const photo = get('profile-avatar');
  const initials = get('profile-initials');
  const save = get('profile-save');
  const upload = get('avatar-upload');
  const query = new URLSearchParams(location.search);
  const publicTag = query.get('tag');
  const api = new URL('../pay/_profiles', location.href);
  let avatar = '';
  let loadId = 0;
  let uploadId = 0;
  let saving = false;
  let uploading = false;

  function setDisabled() {
    save.disabled = saving || uploading;
    input.disabled = saving;
    upload.disabled = saving;
    get('avatar-reset').disabled = saving;
    for (const button of picker.children) button.disabled = saving;
  }

  function cleanTag(value) {
    return value.trim().toLowerCase().replace(/^@/, '');
  }

  function avatarSource(value) {
    if (presets.some(([key]) => key === value)) return '../assets/avatars/' + value + '.webp';
    if (value.length <= 8000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
    return '';
  }

  function drawAvatar(value, tag) {
    const source = avatarSource(value);
    photo.hidden = !source;
    initials.hidden = Boolean(source);
    initials.textContent = tag ? tag.replace(/[_-]/g, '').slice(0, 2).toUpperCase() : '@';
    if (source && photo.getAttribute('src') !== source) photo.src = source;
    if (!source) photo.removeAttribute('src');
    for (const button of picker.children) button.setAttribute('aria-pressed', String(button.value === value));
  }

  photo.onerror = () => { photo.hidden = true; initials.hidden = false; };
  const preview = () => drawAvatar(avatar, cleanTag(input.value));

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
    image.loading = 'lazy';
    button.append(image);
    picker.append(button);
    button.onclick = () => {
      uploadId++;
      uploading = false;
      upload.value = '';
      avatar = key;
      status.textContent = '';
      setDisabled();
      preview();
    };
  }
  input.oninput = preview;
  get('avatar-reset').onclick = () => {
    uploadId++;
    uploading = false;
    upload.value = '';
    avatar = '';
    status.textContent = '';
    setDisabled();
    preview();
  };
  get('profile-connect').onclick = () => get('wallet-button').click();

  async function call(suffix, payload) {
    const response = await fetch(api.href + suffix, {
      ...(payload ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      } : {}),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('The profile service is not deployed yet.');
    const data = await response.json();
    if (response.status === 404 && !payload) return null;
    if (!response.ok) throw new Error(data.error || 'Profile service unavailable.');
    return data;
  }

  function show(profile) {
    const title = get('profile-title');
    const wallet = get('profile-wallet');
    const joined = get('profile-joined');
    const link = get('profile-copy');
    title.textContent = profile ? '@' + profile.tag : 'Your ZeTag';
    wallet.textContent = profile?.wallet ?? window.ZeTagWallet?.address ?? '';
    wallet.hidden = !wallet.textContent;
    joined.textContent = profile ? 'Joined ' + new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(profile.joinedAt)) : '';
    joined.hidden = !profile;
    link.hidden = !profile;
    drawAvatar(profile?.avatar ?? '', profile?.tag ?? '');
    if (profile) link.onclick = async () => {
      const url = new URL(location.href);
      url.search = new URLSearchParams({ tag: profile.tag }).toString();
      try {
        await navigator.clipboard.writeText(url.href);
        status.textContent = 'Profile link copied.';
      } catch {
        status.textContent = 'Open your shareable profile and copy its address.';
        location.href = url.href;
      }
    };
  }

  async function load(address) {
    const id = ++loadId;
    uploadId++;
    uploading = false;
    upload.value = '';
    const connect = get('profile-connect');
    const pay = get('profile-pay');
    form.hidden = true;
    connect.hidden = Boolean(publicTag || address);
    pay.hidden = true;
    show(null);
    if (publicTag && !tags.test(publicTag)) { status.textContent = 'Invalid ZeTag.'; return; }
    if (!publicTag && !address) { status.textContent = 'Connect your wallet to claim or edit your ZeTag.'; return; }
    status.textContent = 'Loading profile…';
    try {
      const profile = await call(publicTag ? '/' + publicTag : '?wallet=' + encodeURIComponent(address));
      if (id !== loadId) return;
      show(profile);
      if (publicTag) {
        status.textContent = profile ? 'USDC transfers are currently unavailable.' : 'This ZeTag has not been claimed.';
        if (profile) {
          pay.href = '../?tag=' + encodeURIComponent(profile.tag);
          pay.hidden = false;
        }
        return;
      }
      avatar = profile?.avatar ?? '';
      input.value = profile ? '@' + profile.tag : '';
      input.readOnly = Boolean(profile);
      save.textContent = profile ? 'Save avatar' : 'Claim @tag';
      form.hidden = false;
      setDisabled();
      preview();
      status.textContent = '';
    } catch (error) {
      if (id === loadId) status.textContent = error.message;
    }
  }

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
      status.textContent = '';
      preview();
    } catch (error) {
      if (id === uploadId) status.textContent = error.message;
    } finally {
      if (id === uploadId) {
        uploading = false;
        upload.value = '';
        setDisabled();
      }
    }
  };

  form.onsubmit = async event => {
    event.preventDefault();
    if (saving || uploading) return;
    const wallet = window.ZeTagWallet;
    const address = wallet?.address;
    const tag = cleanTag(input.value);
    if (!address || !tags.test(tag)) { status.textContent = 'Connect a wallet and enter a tag with 3–24 letters, numbers, underscores, or hyphens.'; return; }
    saving = true;
    setDisabled();
    const id = loadId;
    try {
      status.textContent = 'Preparing your profile…';
      const challenge = await call('/challenge', { wallet: address, tag, avatar });
      if (wallet.address !== address) return;
      status.textContent = 'Approve the profile signature in your wallet.';
      const signature = await wallet.signMessage(challenge.message);
      const profile = await call('', { nonce: challenge.nonce, signature });
      if (id !== loadId) return;
      show(profile);
      input.value = '@' + profile.tag;
      input.readOnly = true;
      save.textContent = 'Save avatar';
      status.textContent = 'Profile saved.';
    } catch (error) {
      if (id === loadId) status.textContent = error.message;
    } finally {
      saving = false;
      setDisabled();
    }
  };

  document.addEventListener('zetag:wallet-changed', event => {
    if (publicTag) return;
    const walletDialog = get('wallet-dialog');
    if (event.detail.address && walletDialog.open) walletDialog.close();
    load(event.detail.address);
  });
  load(window.ZeTagWallet?.address ?? '');
})();
