'use strict';

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
