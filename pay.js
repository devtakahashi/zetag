'use strict';

(async () => {
  const get = id => document.getElementById(id);
  const status = get('pay-status');
  const { validate, formatAmount, applyBranding, normalizeAmount } = ZeTagRequest;
  try {
    const slug = location.pathname.match(/\/pay\/([a-z0-9_.-]+)$/)?.[1];
    let data;
    const fields = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
    const personal = (!slug || slug === 'index.html') && fields.profile === '1';
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
      data = fields;
    }
    const request = validate(personal ? { ...data, amount: '1' } : data);
    if (!request) {
      status.textContent = 'This payment request link is missing information or is invalid.';
      return;
    }
    ZeTagTokens.select(request.asset);
    const picker = get('pay-asset');
    picker.disabled = !personal;
    if (!personal) picker.dataset.fixedAsset = request.asset;
    ZeTagTokens.render();
    applyBranding(document.querySelector('.brand-pair'), { ...fields, name: request.name, tag: request.tag });
    get('pay-title').textContent = personal ? 'Pay ' + request.name : 'Payment request';
    const amount = get('pay-amount');
    amount.parentElement.hidden = personal;
    amount.textContent = personal ? '' : formatAmount(request.amount, request.asset);
    get('pay-note').textContent = request.note;
    get('pay-note').hidden = !request.note;
    get('pay-name').textContent = request.name;
    get('pay-tag').textContent = '@' + request.tag;
    get('pay-request-asset').textContent = request.asset;
    const button = get('pay-button');
    button.textContent = personal ? 'Pay ' + ZeTagTokens.selected : 'Pay ' + amount.textContent + ' ' + request.asset;
    get('pay-custom').hidden = !personal;
    if (personal) get('pay-custom-amount').oninput = event => {
      const total = normalizeAmount(event.target.value, ZeTagTokens.selected);
      button.textContent = total ? 'Pay ' + formatAmount(total, ZeTagTokens.selected) + ' ' + ZeTagTokens.selected : 'Pay ' + ZeTagTokens.selected;
    };
    document.addEventListener('zetag:asset-changed', () => {
      if (personal) get('pay-custom-amount').dispatchEvent(new Event('input'));
    });
    get('pay-details').hidden = false;
    status.hidden = true;
    ZeTagSaved.setRecent(new URL(location.href));
  } catch {
    status.textContent = 'Could not load this payment request. Please try again.';
  }
})();
