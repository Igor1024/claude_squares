/**
 * storage.js — localStorage persistence: save slots, autosave, nickname.
 * Cell data is stored with simple RLE compression.
 */

import { TOTAL_CELLS } from './canvas.js';

const PREFIX    = 'pixel-art:';
const SLOT_KEY  = i => `${PREFIX}slot-${i}`;
const AUTO_KEY  = `${PREFIX}autosave`;
const NICK_KEY  = `${PREFIX}nickname`;
const VISIT_KEY = `${PREFIX}visited`;
export const SLOT_COUNT = 5;

function compress(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const val = data[i];
    let count = 1;
    while (i + count < data.length && data[i + count] === val && count < 255) count++;
    out.push(count, val);
    i += count;
  }
  return out;
}

function decompress(runs, length) {
  const data = new Uint8Array(length);
  let pos = 0;
  for (let i = 0; i + 1 < runs.length; i += 2) {
    const count = runs[i];
    const val   = runs[i + 1];
    for (let k = 0; k < count && pos < length; k++) data[pos++] = val;
  }
  return data;
}

function _read(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function _write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function _remove(key) { try { localStorage.removeItem(key); } catch {} }

function _buildRecord(name, grid, thumbnailDataUrl) {
  return { name: name || 'Без названия', savedAt: new Date().toISOString(), thumbnail: thumbnailDataUrl || null, rle: compress(grid) };
}
function _extractGrid(record) {
  if (!record?.rle) return new Uint8Array(TOTAL_CELLS);
  return decompress(record.rle, TOTAL_CELLS);
}

export function saveSlot(index, name, grid, thumbnailDataUrl) {
  if (index < 0 || index >= SLOT_COUNT) return false;
  return _write(SLOT_KEY(index), _buildRecord(name, grid, thumbnailDataUrl));
}
export function loadSlot(index) {
  const rec = _read(SLOT_KEY(index));
  if (!rec) return null;
  return { name: rec.name, savedAt: rec.savedAt, thumbnail: rec.thumbnail, grid: _extractGrid(rec) };
}
export function deleteSlot(index) { _remove(SLOT_KEY(index)); }
export function getSlots() {
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const rec = _read(SLOT_KEY(i));
    if (!rec) return null;
    return { name: rec.name, savedAt: rec.savedAt, thumbnail: rec.thumbnail };
  });
}
export function autosave(grid, thumbnailDataUrl) {
  _write(AUTO_KEY, _buildRecord('Автосохранение', grid, thumbnailDataUrl));
}
export function getAutosave() {
  const rec = _read(AUTO_KEY);
  if (!rec) return null;
  return { name: rec.name, savedAt: rec.savedAt, thumbnail: rec.thumbnail, grid: _extractGrid(rec) };
}
export function saveNickname(name) { _write(NICK_KEY, name); }
export function getNickname()      { return _read(NICK_KEY); }
export function isFirstVisit()     { return !_read(VISIT_KEY); }
export function markVisited()      { _write(VISIT_KEY, true); }
export function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}