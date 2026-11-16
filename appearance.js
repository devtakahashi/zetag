'use strict';

const walletButton = document.querySelector('#wallet-button');
const walletLabel = document.querySelector('#wallet-label');
const walletDialog = document.querySelector('#wallet-dialog');
const walletTitle = document.querySelector('#wallet-title');
const walletStatus = document.querySelector('#wallet-status');
const walletAction = document.querySelector('#wallet-action');
const walletFallback = document.querySelector('#wallet-fallback');
const provider = window.phantom?.solana;
let address = '';

function renderWallet(error = '') {
  const available = provider?.isPhantom === true;
  walletLabel.textContent = address ? address.slice(0, 4) + '…' + address.slice(-4) : 'Connect Wallet';
  walletTitle.textContent = address ? 'Connected wallet' : 'Connect Wallet';
  walletStatus.textContent = error || address || (available
    ? 'Connect your Solana wallet with Phantom.'
    : 'Open ZeTag in Phantom’s browser on mobile, or install the Phantom extension on desktop.');
  walletAction.hidden = !available;
  walletAction.textContent = address ? 'Disconnect' : 'Connect Phantom';
  walletFallback.hidden = available;
  if (!available) {
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) && location.protocol === 'https:';
    walletFallback.href = mobile
      ? 'https://phantom.app/ul/browse/' + encodeURIComponent(location.href) + '?ref=' + encodeURIComponent(location.origin)
      : 'https://phantom.com/download';
    walletFallback.textContent = mobile ? 'Open in Phantom' : 'Get Phantom';
  }
}

function updateAddress(key) {
  address = key?.toBase58() ?? '';
  renderWallet();
}

walletButton.onclick = () => {
  renderWallet();
  walletDialog.showModal();
};

walletAction.onclick = async () => {
  walletAction.disabled = true;
  try {
    if (address) {
      await provider.disconnect();
      updateAddress(null);
    } else {
      const result = await provider.connect();
      updateAddress(result.publicKey);
    }
    walletDialog.close();
  } catch (error) {
    renderWallet(error?.code === 4001 ? 'Connection declined. You can try again.' : 'Phantom could not complete the request. Try again.');
  } finally {
    walletAction.disabled = false;
  }
};

if (provider?.isPhantom) {
  provider.on('connect', key => updateAddress(key ?? provider.publicKey));
  provider.on('accountChanged', updateAddress);
  provider.on('disconnect', () => updateAddress(null));
}

const ribbon = document.querySelector('#ribbon');
const ctx = ribbon.getContext('2d');

function drawRibbon() {
  if (!ctx) return;
  const { width, height } = ribbon.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  ribbon.width = Math.round(width * ratio);
  ribbon.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, height, width, 0);
  gradient.addColorStop(0, '#3c175900');
  gradient.addColorStop(.42, '#7937ce');
  gradient.addColorStop(.72, '#437ec0');
  gradient.addColorStop(1, '#54d7bc');
  ctx.beginPath();
  ctx.moveTo(width * .05, height * .99);
  ctx.bezierCurveTo(width * .32, height * .99, width * .33, height * .63, width * .51, height * .75);
  ctx.bezierCurveTo(width * .78, height * .95, width * .61, height * .13, width * 1.02, height * .3);
  ctx.strokeStyle = gradient;
  ctx.globalAlpha = .6;
  ctx.shadowColor = '#6d33f3';
  ctx.shadowBlur = 28;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.shadowBlur = 7;
  ctx.lineWidth = 1;
  ctx.stroke();
}
new ResizeObserver(drawRibbon).observe(ribbon);
