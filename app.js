'use strict';

const panel = document.querySelector('#panel');
const status = document.querySelector('#status');
const sendTab = document.querySelector('#sendTab');
const receiveTab = document.querySelector('#receiveTab');
const params = new URLSearchParams(location.search);
const tagPattern = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const amountPattern = /^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$/;
let profile = null;

function cleanTag(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^@/, '');
}

function normalizeAmount(value) {
  const input = String(value ?? '').trim();
  if (!amountPattern.test(input)) return '';
  const normalized = input.replaceAll(',', '');
  return /[1-9]/.test(normalized) ? normalized : '';
}

function walletAllows(form) {
  return form.dispatchEvent(new CustomEvent('zetag:payment-submit', {
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

function paymentLink(tag, amount, note, name) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('tag', tag);
  if (amount) url.searchParams.set('amount', amount);
  if (note) url.searchParams.set('note', note);
  if (name) url.searchParams.set('name', name);
  return url.href;
}

async function copy(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    status.textContent = label;
  } catch {
    status.textContent = 'Copy the value from the field above.';
  }
}

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
      <button class="primary">Create payment link</button>
    </form>
    <div id="output" hidden>
      <label for="url">Your payment request link</label>
      <input id="url" readonly>
      <button class="secondary" id="copy">Copy link</button>
      <a class="linkbutton" id="open">Open payment page</a>
    </div>
    <details><summary>Have a US Zelle Tag?</summary>Zelle Tag linking is currently unavailable.</details>`;
  panel.querySelector('#handle').value = profile?.tag ?? '';
  panel.querySelector('#display').value = profile?.name ?? '';
  panel.querySelector('form').addEventListener('input', () => {
    panel.querySelector('#output').hidden = true;
    status.textContent = '';
  });
  panel.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const tag = cleanTag(values.get('handle'));
    const name = String(values.get('display')).trim();
    const amount = normalizeAmount(values.get('request'));
    if (!tagPattern.test(tag) || !name) {
      status.textContent = 'Choose a tag with 3–24 letters, numbers, underscores or hyphens, and enter a display name.';
      return;
    }
    if (!amount) {
      status.textContent = 'Enter a positive USDC amount, such as 0.23 or 1,000.';
      return;
    }
    if (!walletAllows(event.currentTarget)) return;
    profile = { tag, name };
    try {
      localStorage.setItem('zetag-profile', JSON.stringify(profile));
    } catch {
      status.textContent = 'Your browser blocked local storage. You can still copy this link.';
    }
    const url = paymentLink(tag, amount, values.get('memo').trim(), name);
    panel.querySelector('#url').value = url;
    panel.querySelector('#open').href = url;
    panel.querySelector('#output').hidden = false;
    panel.querySelector('#copy').onclick = () => copy(url, 'Payment link copied.');
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
