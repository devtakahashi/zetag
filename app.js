'use strict';

const panel = document.querySelector('#panel');
const status = document.querySelector('#status');
const sendTab = document.querySelector('#sendTab');
const receiveTab = document.querySelector('#receiveTab');
const params = new URLSearchParams(location.search);
const tagPattern = /^[a-z0-9][a-z0-9_-]{2,23}$/;
const amountPattern = /^[0-9]{1,7}(?:\.[0-9]{1,2})?$/;
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const sample = { tag: 'drevon', name: 'Drevon Studio' };
let profile = null;

function cleanTag(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^@/, '');
}

function validAmount(value) {
  return amountPattern.test(value) && Number(value) > 0;
}

function readProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem('zellpay-profile'));
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
  if (name && tag !== sample.tag) url.searchParams.set('name', name);
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
    <p class="help">Try the demo with @drevon. No funds move.</p>
    <form>
      <label for="to">Recipient tag</label>
      <input id="to" name="tag" placeholder="@drevon" maxlength="25" required>
      <label for="amount">Amount in USDC</label>
      <input id="amount" name="amount" inputmode="decimal" placeholder="0.00" maxlength="10" required>
      <p class="help" id="note" hidden></p>
      <button class="primary">Review payment</button>
    </form>`;
  panel.querySelector('#to').value = tag;
  panel.querySelector('#amount').value = amount;
  if (note) {
    text('#note', note);
    panel.querySelector('#note').hidden = false;
  }
  panel.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const target = cleanTag(values.get('tag'));
    const total = String(values.get('amount')).trim();
    const recipient = [sample, profile].find(item => item?.tag === target)
      ?? (target === tag && tagPattern.test(tag) ? { tag, name: linkedName } : null);
    if (!recipient) {
      status.textContent = 'Tag unavailable in this demo. Try @drevon or a tag saved in this browser.';
      return;
    }
    if (!validAmount(total)) {
      status.textContent = 'Enter a positive amount with up to two decimal places.';
      return;
    }
    review(recipient, total, target === tag ? note : '');
  });
}

function review(recipient, amount, note) {
  status.textContent = '';
  panel.innerHTML = `
    <h2>Review payment</h2>
    <div class="summary"><strong id="total"></strong><p id="recipient"></p><p id="memo"></p></div>
    <p class="help">This is a simulated USDC payment.</p>
    <button class="primary" id="confirm">Simulate payment</button>
    <button class="secondary" id="back">Back</button>`;
  text('#total', currency.format(Number(amount)) + ' USDC');
  text('#recipient', recipient.name ? recipient.name + ' · @' + recipient.tag : '@' + recipient.tag);
  text('#memo', note);
  panel.querySelector('#back').onclick = () => showSend(recipient.tag, amount, note, recipient.name);
  panel.querySelector('#confirm').onclick = () => showReceipt(recipient, amount, note);
}

function showReceipt(recipient, amount, note) {
  const total = currency.format(Number(amount)) + ' USDC';
  const date = new Date().toLocaleString();
  const receipt = ['Zellpay demo receipt', total, 'To @' + recipient.tag, date, note, 'Simulated payment'].filter(Boolean).join('\n');
  panel.innerHTML = `
    <h2>Demo receipt</h2>
    <div class="summary"><strong id="total"></strong><p id="recipient"></p><p id="date"></p><p id="memo"></p></div>
    <button class="primary" id="copy">Copy receipt</button>
    <button class="secondary" id="again">Start another payment</button>`;
  text('#total', total);
  text('#recipient', 'To @' + recipient.tag);
  text('#date', date);
  text('#memo', note);
  panel.querySelector('#copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(receipt);
      status.textContent = 'Demo receipt copied.';
    } catch {
      status.textContent = 'Clipboard unavailable. Select and copy the receipt details.';
    }
  };
  panel.querySelector('#again').onclick = () => showSend();
}

function showReceive() {
  setMode(true);
  panel.innerHTML = `
    <h2>Request a payment</h2>
    <p class="help">Choose a Zellpay Tag and create a link. This demo saves your profile in this browser.</p>
    <form>
      <label for="handle">Your Zellpay Tag</label>
      <input id="handle" name="handle" placeholder="@yourname" maxlength="25" required>
      <label for="display">Display name</label>
      <input id="display" name="display" maxlength="50" placeholder="Your name or business" required>
      <label for="request">Amount in USDC (optional)</label>
      <input id="request" name="request" inputmode="decimal" placeholder="0.00" maxlength="10">
      <label for="memo">Note (optional)</label>
      <input id="memo" name="memo" maxlength="100" placeholder="What’s it for?">
      <button class="primary">Create payment link</button>
    </form>
    <div id="output" hidden>
      <label for="url">Your demo payment link</label>
      <input id="url" readonly>
      <button class="secondary" id="copy">Copy link</button>
      <a class="linkbutton" id="open">Open payment page</a>
    </div>
    <details><summary>Have a US Zelle Tag?</summary>Linking a Zelle Tag requires a way to verify ownership. This demo uses Zellpay Tags.</details>`;
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
    const amount = String(values.get('request')).trim();
    if (!tagPattern.test(tag) || tag === sample.tag || !name) {
      status.textContent = 'Choose a tag with 3–24 letters, numbers, underscores or hyphens, and enter a display name. @drevon is reserved for the demo.';
      return;
    }
    if (amount && !validAmount(amount)) {
      status.textContent = 'Enter a positive amount with up to two decimal places.';
      return;
    }
    profile = { tag, name };
    try {
      localStorage.setItem('zellpay-profile', JSON.stringify(profile));
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
const requestedAmount = params.get('amount') ?? '';
showSend(
  tagPattern.test(requestedTag) ? requestedTag : '',
  validAmount(requestedAmount) ? requestedAmount : '',
  (params.get('note') ?? '').slice(0, 100),
  (params.get('name') ?? '').slice(0, 50)
);
