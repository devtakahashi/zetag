'use strict';

(async () => {
  const get = id => document.getElementById(id);
  const status = get('pay-status');
  const { validate, formatAmount } = ZeTagRequest;
  try {
    const slug = location.pathname.match(/\/pay\/([a-z0-9_.-]+)$/)?.[1];
    let data;
    if (slug && slug !== 'index.html') {
      const response = await fetch(new URL('_requests/' + slug, location.href), {
        signal: AbortSignal.timeout(10000)
      });
      if (response.status === 404) {
        status.textContent = 'This payment request could not be found.';
        return;
      }
      if (!response.ok) throw new Error('Request lookup failed');
      data = await response.json();
    } else {
      data = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
    }
    const request = validate(data);
    if (!request) {
      status.textContent = 'This payment request link is missing information or is invalid.';
      return;
    }
    const amount = formatAmount(request.amount);
    get('pay-amount').textContent = amount;
    get('pay-note').textContent = request.note;
    get('pay-note').hidden = !request.note;
    get('pay-name').textContent = request.name;
    get('pay-tag').textContent = '@' + request.tag;
    get('pay-button').textContent = 'Pay ' + amount + ' USDC';
    get('pay-details').hidden = false;
    status.hidden = true;
  } catch {
    status.textContent = 'Could not load this payment request. Please try again.';
  }
})();
