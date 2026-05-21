/**
 * print.js — PNG export and print support.
 */

export function exportPNG(renderer, includeGrid = true) {
  const offscreen = renderer.renderToOffscreen(includeGrid);
  const dataUrl = offscreen.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `piksel-art-${_timestamp()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function printSheet(renderer, includeGrid = true) {
  const offscreen = renderer.renderToOffscreen(includeGrid);
  const dataUrl = offscreen.toDataURL('image/png');

  let frame = document.getElementById('print-frame');
  if (!frame) {
    frame = document.createElement('div');
    frame.id = 'print-frame';
    document.body.appendChild(frame);
  }
  let printImg = document.getElementById('print-canvas');
  if (!printImg) {
    printImg = document.createElement('img');
    printImg.id = 'print-canvas';
    frame.appendChild(printImg);
  }
  printImg.src = dataUrl;
  printImg.onload = () => window.print();
}

function _timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}