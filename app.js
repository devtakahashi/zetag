'use strict';

const panel = document.querySelector('#panel');
const status = document.querySelector('#status');
const sendTab = document.querySelector('#sendTab');
const receiveTab = document.querySelector('#receiveTab');
const params = new URLSearchParams(location.search);
const { tagPattern, normalizeAmount, formatAmount, branding } = ZeTagRequest;
let profile = null;

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
    ? 'Create a ZeTag payment link to request USDC on Solana, wherever you’re based. Eligible US members can use a linked Zelle Tag once linking is available.'
    : 'Send USDC on Solana by tag. Use a ZeTag handle from anywhere or an eligible US recipient’s Zelle Tag once linking is available.';
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
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Could not save payment request');
    const { slug } = await response.json();
    if (typeof slug !== 'string' || !/^[a-z0-9_.-]+$/.test(slug)) throw new Error('Invalid request link');
    const url = new URL(slug, directory);
    if (request.logo || request.accent !== 'violet') url.hash = new URLSearchParams(branding(request)).toString();
    return url;
  }
  directory.hash = new URLSearchParams(request).toString();
  return directory;
}

function openShare(request, url) {
  const personal = !request.amount;
  document.querySelector('#share-title').textContent = personal ? 'Your payment page is ready' : 'Payment request ready';
  const amount = document.querySelector('#share-amount');
  amount.parentElement.hidden = personal;
  amount.textContent = personal ? '' : formatAmount(request.amount);
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
    const code = qrcode(0, 'M');
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
  panel.querySelector('#handle')?.focus();
};

function showSend(tag = '', amount = '', note = '', linkedName = '') {
  setMode(false);
  panel.innerHTML = `
    <h2>Send USDC</h2>
    <p class="help">Enter a ZeTag or a linked Zelle Tag. Sending is currently unavailable.</p>
    <form>
      <label for="to">Recipient tag</label>
      <input id="to" name="tag" placeholder="@recipient" maxlength="25" required>
      <label for="amount">Amount in USDC</label>
      <input id="amount" name="amount" inputmode="decimal" placeholder="0.00" required>
      <p class="help" id="note" hidden></p>
      <button class="primary">Review payment</button>
    </form>`;
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
    const total = normalizeAmount(values.get('amount'));
    if (!tagPattern.test(target)) {
      status.textContent = 'Enter a valid recipient tag.';
      return;
    }
    if (!total) {
      status.textContent = 'Enter a positive USDC amount, such as 0.23 or 1,000.';
      return;
    }
    if (!walletAllows(event.currentTarget)) return;
    status.textContent = 'USDC transfers are currently unavailable.';
  });
}

function showReceive() {
  setMode(true);
  panel.innerHTML = `
    <h2>Request a payment</h2>
    <p class="help">Choose a handle and create a request link. Your handle is saved in this browser.</p>
    <form>
      <label for="handle">Your ZeTag</label>
      <input id="handle" name="handle" placeholder="@yourname" maxlength="25" required>
      <label for="display">Display name</label>
      <input id="display" name="display" maxlength="50" placeholder="Your name or business" required>
      <label for="request">Amount in USDC</label>
      <input id="request" name="request" inputmode="decimal" placeholder="0.00" required>
      <label for="memo">Note (optional)</label>
      <input id="memo" name="memo" maxlength="100" placeholder="What’s it for?">
      <details class="branding-options">
        <summary>Customize your payment page</summary>
        <label for="request-logo">Logo image URL (optional)</label>
        <input id="request-logo" name="logo" type="url" placeholder="https://…" maxlength="300">
        <label for="request-accent">Accent color</label>
        <select id="request-accent" name="accent">
          <option value="violet">Violet</option><option value="mint">Mint</option>
          <option value="blue">Blue</option><option value="rose">Rose</option>
        </select>
      </details>
      <button class="primary" type="submit" value="request">Create payment link</button>
      <button class="secondary" type="submit" value="personal" formnovalidate>Create personal payment page</button>
    </form>
    <details><summary>Have a US Zelle Tag?</summary>Zelle Tag linking is currently unavailable.</details>`;
  panel.querySelector('#handle').value = profile?.tag ?? '';
  panel.querySelector('#display').value = profile?.name ?? '';
  const savedBrand = branding(profile ?? {});
  panel.querySelector('#request-logo').value = savedBrand.logo;
  panel.querySelector('#request-accent').value = savedBrand.accent;
  panel.querySelector('form').addEventListener('input', () => {
    status.textContent = '';
  });
  panel.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = event.submitter ?? form.querySelector('button[type=submit]');
    const personal = submit.value === 'personal';
    if (form.dataset.creating) return;
    const values = new FormData(form);
    const tag = cleanTag(values.get('handle'));
    const name = String(values.get('display')).trim();
    const amount = normalizeAmount(values.get('request'));
    if (!tagPattern.test(tag) || !name) {
      status.textContent = 'Choose a tag with 3–24 letters, numbers, underscores or hyphens, and enter a display name.';
      return;
    }
    if (!personal && !amount) {
      status.textContent = 'Enter a positive USDC amount, such as 0.23 or 1,000.';
      return;
    }
    const brand = branding({ logo: values.get('logo'), accent: values.get('accent') });
    if (values.get('logo').trim() && !brand.logo) {
      status.textContent = 'Use a valid HTTPS image URL for your logo.';
      return;
    }
    if (!walletAllows(form, submit)) return;
    profile = { tag, name, ...brand };
    try {
      localStorage.setItem('zetag-profile', JSON.stringify(profile));
    } catch {
      status.textContent = 'Your browser blocked local storage. You can still copy this link.';
    }
    const request = { tag, amount: personal ? '' : amount, note: values.get('memo').trim(), name, ...brand };
    form.dataset.creating = 'true';
    submit.disabled = true;
    try {
      let url;
      if (personal) {
        url = new URL('./pay/', location.href);
        url.hash = new URLSearchParams({ ...request, profile: '1' }).toString();
      } else {
        url = await paymentLink(request);
      }
      if (form.isConnected) openShare(request, url);
    } catch {
      if (form.isConnected) status.textContent = 'Could not create the link. Please try again.';
    } finally {
      delete form.dataset.creating;
      submit.disabled = false;
    }
  });
}

profile = readProfile();
sendTab.onclick = () => showSend();
receiveTab.onclick = showReceive;
const requestedTag = cleanTag(params.get('tag'));
const requestedAmount = normalizeAmount(params.get('amount'));
showSend(
  tagPattern.test(requestedTag) ? requestedTag : '',
  requestedAmount,
  (params.get('note') ?? '').slice(0, 100),
  (params.get('name') ?? '').slice(0, 50)
);
