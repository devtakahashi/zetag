'use strict';

(() => {
  const root = new URL('./', document.currentScript.src);
  const steps = [
    {
      title: 'Connect your wallet',
      text: 'Open Wallet, select your wallet, then tap Connect. Approve the request in your wallet app and return to ZeTag. Keep using the browser where you started.',
      selector: '#wallet-button',
      action: 'Connect wallet',
      run() { document.getElementById('wallet-button').click(); }
    },
    {
      title: 'Claim your @tag',
      text: 'Open your profile and sign the message to verify your wallet. Choose an available tag. Your tag will let other people find you and open your payment profile.',
      selector: '.profile-menu, .profile-link',
      action: 'Open profile',
      run() { location.href = new URL('profile/', root); }
    },
    {
      title: 'Make your profile yours',
      text: 'Use the pencil on your profile to add a bio and choose an avatar or upload a photo. If you claim a tag without choosing an avatar, ZeTag saves a random default for you.',
      selector: '#profile-edit',
      action: 'Edit profile',
      run() {
        const edit = document.getElementById('profile-edit');
        if (edit && !edit.hidden) edit.click();
        else location.href = new URL('profile/', root);
      }
    },
    {
      title: 'Send by tag',
      text: 'Find a recipient’s @tag and open ZePay. Choose USDC or SOL, enter the amount, and review the recipient and token. Live payments are currently unavailable.',
      selector: '#profile-pay, #sendTab',
      action: 'Open Send',
      run() { location.href = root; }
    },
    {
      title: 'Receive a payment',
      text: 'Share your profile using the copy icon, or use Receive to create an amount-specific request or a reusable payment page. Choose USDC or SOL before sharing the link. Live payments are currently unavailable.',
      selector: '#profile-copy, #receiveTab',
      action: 'Open Receive',
      run() { location.href = new URL('?mode=receive', root); }
    },
    {
      title: 'Reach someone with Ping',
      text: 'Open someone’s profile and tap the message icon. Unread counts sit beside tags in your inbox. One muted tick means delivered. Two violet ticks mean the recipient has read the message. The bell’s violet dot signals new activity.',
      selector: '#profile-ping, #notifications-button',
      action: 'Open Ping inbox',
      run() {
        const inbox = document.getElementById('ping-inbox');
        if (inbox) inbox.click();
        else location.href = new URL('profile/?ping=inbox', root);
      }
    }
  ];
  const dialog = document.createElement('dialog');
  dialog.className = 'guide-dialog';
  dialog.setAttribute('aria-labelledby', 'guide-title');
  dialog.innerHTML = '<div class="dialog-heading"><h2 id="guide-title">How to use ZeTag</h2><form method="dialog"><button class="wallet-close" aria-label="Close guide">×</button></form></div><div class="guide-steps" aria-label="Guide steps"></div><h3 id="guide-step-title"></h3><p id="guide-copy"></p><div class="guide-actions"><button class="primary" id="guide-action" type="button"></button><button class="text-action" id="guide-next" type="button">Next →</button></div>';
  document.body.append(dialog);
  let active = 0;
  let highlight;
  const stepBar = dialog.querySelector('.guide-steps');
  for (const [index, step] of steps.entries()) {
    const control = document.createElement('button');
    control.type = 'button';
    control.setAttribute('aria-label', step.title);
    control.onclick = () => show(index);
    stepBar.append(control);
  }

  function show(index) {
    active = index;
    highlight?.classList.remove('guide-highlight');
    const step = steps[index];
    highlight = [...document.querySelectorAll(step.selector)].find(el => el.getClientRects().length && !el.hidden);
    // A mobile wallet entry lives in the profile dropdown.
    if (!highlight && index === 0) highlight = document.querySelector('.profile-menu');
    highlight?.classList.add('guide-highlight');
    highlight?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    for (const [i, button] of Array.from(stepBar.children).entries()) {
      if (i === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    dialog.querySelector('#guide-step-title').textContent = step.title;
    dialog.querySelector('#guide-copy').textContent = step.text;
    dialog.querySelector('#guide-action').textContent = step.action;
    dialog.querySelector('#guide-next').textContent = index === steps.length - 1 ? 'Done' : 'Next →';
  }
  dialog.querySelector('#guide-action').onclick = () => { dialog.close(); steps[active].run(); };
  dialog.querySelector('#guide-next').onclick = () => {
    if (active === steps.length - 1) dialog.close();
    else show(active + 1);
  };
  dialog.addEventListener('close', () => highlight?.classList.remove('guide-highlight'));
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-guide]')) return;
    for (const open of document.querySelectorAll('dialog[open]')) open.close();
    for (const menu of document.querySelectorAll('details.profile-menu')) menu.open = false;
    show(0);
    dialog.showModal();
  });
})();
