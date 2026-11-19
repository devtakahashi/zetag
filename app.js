'use strict';

const panel = document.querySelector('#panel');
const status = document.querySelector('#status');
const sendTab = document.querySelector('#sendTab');
const receiveTab = document.querySelector('#receiveTab');
const params = new URLSearchParams(location.search);
const { tagPattern, normalizeAmount, formatAmount, branding, applyBranding } = ZeTagRequest;
let profile = null;
let connectedAddress = '';
const tokens = ZeTagTokens;

function cleanTag(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^@/, '');
}

function walletAllows(form, submitter) {
  return form.dispatchEvent(new CustomEvent('zetag:payment-submit', {
    detail: { submitter },
    bubbles: true,
    cancelable: true
  }));
}

function readProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem('zetag-profile'));
    if (saved && tagPattern.test(saved.tag) && typeof saved.name === 'string') return saved;
  } catch {
    return null;
  }
  return null;
}

function setMode(receiving) {
  sendTab.setAttribute('aria-pressed', String(!receiving));
  receiveTab.setAttribute('aria-pressed', String(receiving));
  status.textContent = '';
  document.querySelector('#hero-title').textContent = receiving ? 'Receive money.' : 'Send money.';
  document.querySelector('#hero-accent').textContent = receiving ? 'Share your tag.' : 'Pay by tag.';
  document.querySelector('#hero-copy').textContent = receiving
    ? 'Create a ZeTag payment link to request USDC or SOL on Solana, wherever you’re based. Eligible US members can use a linked Zelle Tag once linking is available.'
    : 'Send USDC or SOL on Solana by tag. Use a ZeTag handle from anywhere or an eligible US recipient’s Zelle Tag once linking is available.';
}

function text(selector, value) {
  panel.querySelector(selector).textContent = value;
}

const shareDialog = document.querySelector('#share-dialog');
const shareUrl = document.querySelector('#share-url');
const shareCopy = document.querySelector('#share-copy');
const shareFeedback = document.querySelector('#share-feedback');

async function paymentLink(request) {
  const directory = new URL('./pay/', location.href);
  if (document.querySelector('meta[name="zetag-short-links"]')?.content === 'enabled') {
    const response = await fetch(new URL('_requests', directory), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: request.tag, amount: request.amount, name: request.name, note: request.note, asset: request.asset ?? 'USDC' }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Could not save payment request');
    const { slug } = await response.json();
    if (typeof slug !== 'string' || !/^[a-z0-9_.-]+$/.test(slug)) throw new Error('Invalid request link');
    const url = new URL(slug, directory);
    if (request.logo) url.hash = new URLSearchParams(branding(request)).toString();
    return url;
  }
  directory.hash = new URLSearchParams(request).toString();
  return directory;
}

function openShare(request, url) {
  applyBranding(shareDialog.querySelector('.brand-pair'), request);
  const personal = !request.amount;
  document.querySelector('#share-title').textContent = personal ? 'Your payment page is ready' : 'Payment request ready';
  const amount = document.querySelector('#share-amount');
  amount.parentElement.hidden = personal;
  amount.textContent = personal ? '' : formatAmount(request.amount, request.asset);
  document.querySelector('#share-asset').textContent = request.asset ?? 'USDC';
  document.querySelector('#share-preview').textContent = personal ? 'Preview page' : 'Preview as payer';
  document.querySelector('#share-edit').textContent = personal ? 'Edit page' : 'Edit request';
  const note = document.querySelector('#share-note');
  note.textContent = request.note;
  note.hidden = !request.note;
  document.querySelector('#share-person').textContent = request.name + ' · @' + request.tag;
  shareUrl.value = url.href;
  shareUrl.hidden = Boolean(url.hash);
  document.querySelector('#share-preview').href = url.href;
  shareCopy.textContent = personal ? 'Copy page link' : 'Copy payment link';
  shareFeedback.textContent = '';
  setQR(false);
  shareDialog.showModal();
}

const shareQR = document.querySelector('#share-qr');
const shareNative = document.querySelector('#share-native');
shareNative.hidden = typeof navigator.share !== 'function';

function setQR(open) {
  document.querySelector('#share-code').hidden = !open;
  shareQR.setAttribute('aria-expanded', String(open));
  shareQR.textContent = open ? 'Hide QR code' : 'Show QR code';
}

shareQR.onclick = () => {
  if (shareQR.getAttribute('aria-expanded') === 'true') { setQR(false); return; }
  try {
    const code = qrcode(0, shareUrl.value.length > 1200 ? 'L' : 'M');
    code.addData(shareUrl.value);
    code.make();
    const canvas = document.querySelector('#share-canvas');
    canvas.width = canvas.height = (code.getModuleCount() + 8) * 4;
    const ink = canvas.getContext('2d');
    ink.fillStyle = '#fff';
    ink.fillRect(0, 0, canvas.width, canvas.height);
    ink.fillStyle = '#111';
    for (let row = 0; row < code.getModuleCount(); row++) {
      for (let col = 0; col < code.getModuleCount(); col++) {
        if (code.isDark(row, col)) ink.fillRect((col + 4) * 4, (row + 4) * 4, 4, 4);
      }
    }
    setQR(true);
  } catch {
    shareFeedback.textContent = 'Could not create a QR code. Copy the link to share it.';
  }
};

shareNative.onclick = async () => {
  try { await navigator.share({ title: 'ZeTag payment link', url: shareUrl.value }); }
  catch (error) {
    if (error.name !== 'AbortError') shareFeedback.textContent = 'Sharing is unavailable. Copy the link to share it.';
  }
};

shareCopy.onclick = async () => {
  const url = shareUrl.value;
  try {
    await navigator.clipboard.writeText(url);
    if (shareDialog.open && shareUrl.value === url) shareCopy.textContent = 'Link copied';
  } catch {
    if (!shareDialog.open || shareUrl.value !== url) return;
    shareUrl.hidden = false;
    shareUrl.focus();
    shareUrl.select();
    shareFeedback.textContent = 'Copy the selected link.';
  }
};
document.querySelector('#share-edit').onclick = () => {
  shareDialog.close();
  if (panel.querySelector('#personal-result:not([hidden])')) panel.querySelector('#personal-edit').click();
  else panel.querySelector('#handle')?.focus();
};

function showSend(tag = '', amount = '', note = '', linkedName = '') {
  setMode(false);
  panel.innerHTML = `
    <h2>Send <span data-asset-symbol>USDC</span></h2>
    <p class="help">Enter a ZeTag or a linked Zelle Tag. Sending is currently unavailable.</p>
    <form>
      <label for="to">Recipient tag</label>
      <input id="to" name="tag" placeholder="@recipient" maxlength="25" required>
      <label for="amount">Amount</label>
      <div class="amount-field"><input id="amount" name="amount" inputmode="decimal" placeholder="0.00" required><button type="button" class="asset-picker" data-asset-picker></button></div>
      <p class="help" id="note" hidden></p>
      <button class="primary">Review payment</button>
    </form>`;
  tokens.render();
  panel.querySelector('#to').value = tag;
  panel.querySelector('#amount').value = amount;
  if (linkedName && tag) {
    const details = document.createElement('p');
    details.className = 'help';
    details.textContent = 'Request from ' + linkedName + ' (@' + tag + ')';
    panel.querySelector('form').before(details);
  }
  if (note) {
    text('#note', note);
    panel.querySelector('#note').hidden = false;
  }
  panel.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const target = cleanTag(values.get('tag'));
    const total = normalizeAmount(values.get('amount'), tokens.selected);
    if (!tagPattern.test(target)) {
      status.textContent = 'Enter a valid recipient tag.';
      return;
    }
    if (!total) {
      status.textContent = 'Enter a positive ' + tokens.selected + ' amount with up to ' + tokens.assets[tokens.selected].decimals + ' decimal places.';
      return;
    }
    if (!walletAllows(event.currentTarget)) return;
    status.textContent = tokens.selected + ' transfers are currently unavailable.';
  });
}

async function compactLogo(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPG, or WebP image up to 8 MB.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    for (const size of [64, 48, 32]) {
      canvas.width = canvas.height = size;
      const side = Math.min(bitmap.width, bitmap.height);
      context.fillStyle = '#31234b';
      context.fillRect(0, 0, size, size);
      context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
      for (const type of ['image/webp', 'image/jpeg']) {
        const result = canvas.toDataURL(type, .58);
        if (branding({ logo: result }).logo) return result;
      }
    }
    throw new Error('Could not prepare this image. Try a simpler logo.');
  } finally {
    bitmap.close();
  }
}

function showReceive() {
  setMode(true);
  panel.innerHTML = `
    <button class="text-action" id="back-to-request" type="button" hidden>← Back to payment request</button>
    <h2 id="receive-title">Request a payment</h2>
    <p class="help" id="receive-help">Create a link for a specific amount.</p>
    <section id="saved-payment-page" class="saved-payment-page" hidden>
      <div><strong>My payment page</strong><p id="saved-payment-tag"></p></div>
      <div class="saved-page-actions">
        <a class="text-action" id="saved-payment-open" target="_blank" rel="noopener">Open page</a>
        <button class="text-action" id="saved-payment-copy" type="button">Copy link</button>
      </div>
      <input id="saved-payment-url" readonly hidden aria-label="Saved payment page link">
    </section>
    <form>
      <label for="handle">Your ZeTag</label>
      <input id="handle" name="handle" placeholder="@yourname" maxlength="25" required>
      <label for="display">Display name</label>
      <input id="display" name="display" maxlength="50" placeholder="Your name or business" required>
      <div id="request-fields">
        <label for="request">Amount</label>
        <div class="amount-field"><input id="request" name="request" inputmode="decimal" placeholder="0.00" required><button type="button" class="asset-picker" data-asset-picker></button></div>
        <label for="memo">Note (optional)</label>
        <input id="memo" name="memo" maxlength="100" placeholder="What’s it for?">
      </div>
      <label class="logo-upload" for="request-logo"><strong>Upload logo</strong><small>Optional · PNG, JPG, or WebP</small></label>
      <input class="logo-file" id="request-logo" type="file" accept="image/png,image/jpeg,image/webp">
      <button class="text-action" id="clear-logo" type="button" hidden>Remove logo</button>
      <div class="live-brand" id="live-brand" hidden>
        <p>Live preview</p>
        <div class="brand-pair" aria-hidden="true">
  <span class="pair-platform"><span class="brand-mark"></span></span>
  <span class="pair-arrow">↔</span>
  <span class="pair-recipient"><img alt="" referrerpolicy="no-referrer" hidden><span class="badge-initials" hidden></span><span class="wallet-icon"></span></span>
</div>
      </div>
      <div class="payment-create-actions">
        <button class="primary" type="submit"><span>Payment link</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>
        <button class="secondary" id="personal-editor" type="button"><span>Payment page</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>
      </div>
    </form>
    <section class="personal-result" id="personal-result" hidden>
      <h3>Your page is ready</h3>
      <p id="personal-recipient"></p>
      <button type="button" class="primary" id="personal-copy">Copy page link</button>
      <input id="personal-url" aria-label="Personal payment page link" readonly hidden>
      <div class="request-actions">
        <a id="personal-preview" target="_blank" rel="noopener">Open payment page</a>
        <button id="personal-share" type="button">Share or show QR</button>
        <button id="personal-edit" type="button">Edit page</button>
      </div>
    </section>
    <details id="zelle-details"><summary>Have a US Zelle Tag?</summary>Zelle Tag linking is currently unavailable.</details>`;
  tokens.render();
  const get = selector => panel.querySelector(selector);
  const form = get('form');
  const handle = get('#handle');
  const display = get('#display');
  const file = get('#request-logo');
  const clear = get('#clear-logo');
  const submit = get('button[type=submit]');
  const result = get('#personal-result');
  const amountInput = get('#request');
  let personal = false;
  let logo = branding(profile ?? {}).logo;
  let uploadVersion = 0;
  let imageBusy = false;
  handle.value = profile?.tag ?? '';
  display.value = profile?.name ?? '';

  function updatePreview() {
    applyBranding(get('.live-brand .brand-pair'), { logo, name: display.value.trim(), tag: cleanTag(handle.value) });
    clear.hidden = !logo && !imageBusy;
  }

  function setPersonal(enabled) {
    personal = enabled;
    refreshSavedPage();
    form.hidden = false;
    result.hidden = true;
    get('#request-fields').hidden = enabled;
    amountInput.disabled = enabled;
    get('#live-brand').hidden = !enabled;
    get('#personal-editor').hidden = enabled;
    get('#back-to-request').hidden = !enabled;
    get('#zelle-details').hidden = enabled;
    get('#receive-title').textContent = enabled ? 'Set up your payment page' : 'Request a payment';
    get('#receive-help').textContent = enabled ? 'Share one reusable page and let the payer choose the amount.' : 'Create a link for a specific amount.';
    submit.querySelector('span').textContent = enabled ? 'Save page' : 'Payment link';
    status.textContent = '';
    updatePreview();
  }

  get('#personal-editor').onclick = () => { setPersonal(true); handle.focus(); };
  get('#back-to-request').onclick = () => { setPersonal(false); amountInput.focus(); };
  get('#personal-edit').onclick = () => { setPersonal(true); handle.focus(); };
  form.addEventListener('input', () => { status.textContent = ''; updatePreview(); });
  file.onchange = async () => {
    if (!file.files[0]) return;
    const version = ++uploadVersion;
    imageBusy = true;
    submit.disabled = true;
    updatePreview();
    status.textContent = 'Preparing your logo…';
    try {
      const data = await compactLogo(file.files[0]);
      if (version !== uploadVersion || !form.isConnected) return;
      logo = data;
      status.textContent = 'Logo ready.';
    } catch (error) {
      if (version === uploadVersion && form.isConnected) status.textContent = error.message || 'Could not read this image.';
    } finally {
      if (version === uploadVersion && form.isConnected) {
        imageBusy = false;
        submit.disabled = Boolean(form.dataset.creating);
        file.value = '';
        updatePreview();
      }
    }
  };
  clear.onclick = () => {
    uploadVersion++;
    imageBusy = false;
    submit.disabled = Boolean(form.dataset.creating);
    file.value = '';
    logo = '';
    status.textContent = '';
    updatePreview();
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (form.dataset.creating || imageBusy) return;
    const tag = cleanTag(handle.value);
    const name = display.value.trim();
    const amount = personal ? '' : normalizeAmount(amountInput.value, tokens.selected);
    if (!tagPattern.test(tag) || !name) {
      status.textContent = 'Choose a valid tag and enter a display name.';
      return;
    }
    if (!personal && !amount) {
      status.textContent = 'Enter a positive ' + tokens.selected + ' amount with up to ' + tokens.assets[tokens.selected].decimals + ' decimal places.';
      return;
    }
    if (!walletAllows(form, event.submitter ?? submit)) return;
    profile = { tag, name, logo };
    try {
      localStorage.setItem('zetag-profile', JSON.stringify(profile));
    } catch {
      status.textContent = 'Your browser blocked local storage. You can still share this link.';
    }
    const request = { ...profile, asset: tokens.selected, amount, note: personal ? '' : get('#memo').value.trim() };
    if (personal) {
      const url = new URL('./pay/', location.href);
      url.hash = new URLSearchParams({ ...request, profile: '1' }).toString();
      if (!ZeTagSaved.walletPage(connectedAddress, url)) {
        status.textContent = 'This browser could not save the page. Copy the link to keep it.';
      }
      refreshSavedPage();
      form.hidden = true;
      result.hidden = false;
      get('#personal-recipient').textContent = name + ' · @' + tag;
      get('#personal-preview').href = url.href;
      const field = get('#personal-url');
      field.hidden = true;
      field.value = url.href;
      get('#personal-copy').onclick = async () => {
        try {
          await navigator.clipboard.writeText(url.href);
          status.textContent = 'Page link copied.';
        } catch {
          field.hidden = false;
          field.focus();
          field.select();
        }
      };
      get('#personal-share').onclick = () => openShare(request, url);
      get('#personal-copy').focus();
      return;
    }
    form.dataset.creating = 'true';
    submit.disabled = true;
    try {
      const url = await paymentLink(request);
      if (form.isConnected) openShare(request, url);
    } catch {
      if (form.isConnected) status.textContent = 'Could not create the link. Please try again.';
    } finally {
      delete form.dataset.creating;
      submit.disabled = imageBusy;
    }
  });
  updatePreview();
  refreshSavedPage();
}

function refreshSavedPage() {
  const card = panel.querySelector('#saved-payment-page');
  if (!card) return;
  const url = ZeTagSaved.walletPage(connectedAddress);
  card.hidden = !url;
  if (!url) return;
  const fields = new URLSearchParams(url.hash.slice(1));
  card.querySelector('#saved-payment-tag').textContent = '@' + (fields.get('tag') ?? '');
  card.querySelector('#saved-payment-open').href = url.href;
  const field = card.querySelector('#saved-payment-url');
  field.value = url.href;
  field.hidden = true;
  card.querySelector('#saved-payment-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(url.href);
      status.textContent = 'Page link copied.';
    } catch {
      field.hidden = false;
      field.focus();
      field.select();
    }
  };
}

document.addEventListener('zetag:wallet-changed', event => {
  connectedAddress = event.detail.address;
  refreshSavedPage();
});

profile = readProfile();
sendTab.onclick = () => showSend();
receiveTab.onclick = showReceive;
const requestedTag = cleanTag(params.get('tag'));
const requestedAsset = params.get('asset') || 'USDC';
if (Object.hasOwn(tokens.assets, requestedAsset)) tokens.select(requestedAsset);
const requestedAmount = normalizeAmount(params.get('amount'), tokens.selected);
showSend(
  tagPattern.test(requestedTag) ? requestedTag : '',
  requestedAmount,
  (params.get('note') ?? '').slice(0, 100),
  (params.get('name') ?? '').slice(0, 50)
);
if (params.get('mode') === 'receive') showReceive();
