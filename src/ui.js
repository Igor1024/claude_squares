/**
 * ui.js — Toolbar, modals, status bar, minimap, save/load dialogs.
 */

import { COLS, ROWS, TOTAL_CELLS, REAL_CELL_SIZE } from './canvas.js';
import {
  saveSlot, loadSlot, deleteSlot, getSlots, autosave,
  SLOT_COUNT, formatDate,
} from './storage.js';
import { exportPNG, printSheet } from './print.js';

const COLOR_LABELS = { 1: 'Чёрный', 2: 'Синий', 3: 'Красный' };
const TOOL_LABELS  = { pen: 'Ручка', eraser: 'Ластик', hand: 'Рука' };
const COLOR_CSS    = { 1: '#1a1a2e', 2: '#1a3a8f', 3: '#c0392b' };

export class UI {
  constructor(app, renderer, tools) {
    this.app      = app;
    this.renderer = renderer;
    this.tools    = tools;
    this._minimapDirty  = true;
    this._minimapCanvas = null;
    this._minimapRect   = null;
  }

  init() {
    this._initToolbar();
    this._initMobileToolbar();
    this._initMinimap();
    this._updateStatusBar();
  }

  _initToolbar() {
    _on('tool-pen',    'click', () => this._selectTool('pen'));
    _on('tool-eraser', 'click', () => this._selectTool('eraser'));
    _on('tool-hand',   'click', () => this._selectTool('hand'));
    _on('undo-btn', 'click', () => { this.tools.undo(); this._updateUndoRedo(); });
    _on('redo-btn', 'click', () => { this.tools.redo(); this._updateUndoRedo(); });
    document.querySelectorAll('.color-btn[data-color]').forEach(btn => {
      btn.addEventListener('click', () => this._selectColor(btn.dataset.color));
    });
    _on('zoom-in',  'click', () => this._zoomCenter(1.25));
    _on('zoom-out', 'click', () => this._zoomCenter(1 / 1.25));
    _on('zoom-fit', 'click', () => { this.renderer.fitToScreen(); this._updateZoom(); this._renderMinimap(); });
    _on('save-btn',   'click', () => this.showSaveDialog());
    _on('load-btn',   'click', () => this.showLoadDialog());
    _on('export-btn', 'click', () => this.showExportDialog());
    _on('print-btn',  'click', () => this.showPrintDialog());
    this._updateUndoRedo();
  }

  _initMobileToolbar() {
    _on('m-tool-pen',    'click', () => this._selectTool('pen'));
    _on('m-tool-eraser', 'click', () => this._selectTool('eraser'));
    _on('m-tool-hand',   'click', () => this._selectTool('hand'));
    _on('m-undo',  'click', () => { this.tools.undo(); this._updateUndoRedo(); });
    _on('m-redo',  'click', () => { this.tools.redo(); this._updateUndoRedo(); });
    _on('m-zoom-in',  'click', () => this._zoomCenter(1.25));
    _on('m-zoom-out', 'click', () => this._zoomCenter(1 / 1.25));
    _on('m-zoom-fit', 'click', () => { this.renderer.fitToScreen(); this._updateZoom(); this._renderMinimap(); });
    _on('m-save',   'click', () => this.showSaveDialog());
    _on('m-load',   'click', () => this.showLoadDialog());
    _on('m-export', 'click', () => this.showExportDialog());
    _on('m-print',  'click', () => this.showPrintDialog());
    document.querySelectorAll('.mobile-color-btn[data-color]').forEach(btn => {
      btn.addEventListener('click', () => this._selectColor(btn.dataset.color));
    });
  }

  _initMinimap() {
    this._minimapCanvas = document.getElementById('minimap-canvas');
    this._minimapRect   = document.createElement('div');
    this._minimapRect.className = 'minimap-viewport-rect';
    document.getElementById('minimap-container').appendChild(this._minimapRect);
    const mc = this._minimapCanvas;
    mc.width  = mc.offsetWidth  || 120;
    mc.height = mc.offsetHeight || 170;
    this._renderMinimap();
  }

  _selectTool(t) {
    this.tools.setTool(t);
    document.querySelectorAll('[id^="tool-"], [id^="m-tool-"]').forEach(b => b.classList.remove('active'));
    _el('tool-' + t)?.classList.add('active');
    _el('m-tool-' + t)?.classList.add('active');
    this._updateStatusBar();
  }

  _selectColor(name) {
    const map = { black: 1, blue: 2, red: 3 };
    this.tools.setColor(map[name] || 1);
    document.querySelectorAll('.color-btn, .mobile-color-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color === name);
    });
    this._updateStatusBar();
  }

  _zoomCenter(factor) {
    const cx = this.renderer.viewWidth  / 2;
    const cy = this.renderer.viewHeight / 2;
    this.renderer.zoom(factor, cx, cy);
    this._updateZoom();
    this._renderMinimap();
  }

  _updateZoom() {
    _setText('zoom-level', this.renderer.getZoomPercent() + '%');
    document.getElementById('minimap-container')?.classList.toggle('hidden', this.renderer.isFitToScreen());
  }

  updateCoords(col, row) {
    if (col == null) { _setText('status-coords', '— / —'); return; }
    _setText('status-coords', `Кол. ${col + 1}, стр. ${row + 1}`);
  }

  updateProgress(filled, total) {
    const pct = total ? Math.round(filled / total * 100) : 0;
    _setText('status-progress', `${filled} / ${total} кл. (${pct}%)`);
  }

  _updateStatusBar() {
    _setText('status-tool', TOOL_LABELS[this.tools.getCurrentTool()] || this.tools.getCurrentTool());
    const colorDot = document.getElementById('status-color');
    if (colorDot) colorDot.style.background = COLOR_CSS[this.tools.getCurrentColor()] || '#333';
    this.updateProgress(this.renderer.getFilledCount(), TOTAL_CELLS);
  }

  _updateUndoRedo() {
    ['undo-btn', 'm-undo'].forEach(id => { const b = _el(id); if (b) b.disabled = !this.tools.canUndo(); });
    ['redo-btn', 'm-redo'].forEach(id => { const b = _el(id); if (b) b.disabled = !this.tools.canRedo(); });
  }

  onGridChange() {
    this._updateStatusBar();
    this._updateUndoRedo();
    this._minimapDirty = true;
    if (!this._minimapRafId) {
      this._minimapRafId = requestAnimationFrame(() => { this._minimapRafId = null; this._renderMinimap(); });
    }
  }

  _renderMinimap() {
    const mc = this._minimapCanvas;
    if (!mc) return;
    this.renderer.renderMinimap(mc);
    this._updateMinimapViewport();
    this._updateZoom();
    this._minimapDirty = false;
  }

  _updateMinimapViewport() {
    if (!this._minimapRect || !this._minimapCanvas) return;
    const mc  = this._minimapCanvas;
    const rect = this.renderer.getViewportCellRect();
    const mw  = mc.offsetWidth  || 120;
    const mh  = mc.offsetHeight || 170;
    const scX = mw / COLS;
    const scY = mh / ROWS;
    Object.assign(this._minimapRect.style, {
      left:   Math.floor(rect.x * scX) + 'px',
      top:    Math.floor(rect.y * scY) + 'px',
      width:  Math.ceil(rect.w  * scX) + 'px',
      height: Math.ceil(rect.h  * scY) + 'px',
    });
  }

  _showModal(el) {
    const overlay = document.getElementById('modal-overlay');
    const box     = document.getElementById('modal-content');
    box.innerHTML = '';
    if (typeof el === 'string') box.innerHTML = el; else box.appendChild(el);
    overlay.classList.remove('hidden');
    const close = e => { if (e.target === overlay) this._hideModal(); };
    overlay.addEventListener('click', close);
    overlay._closeHandler = close;
  }

  _hideModal() {
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('hidden');
    if (overlay._closeHandler) { overlay.removeEventListener('click', overlay._closeHandler); overlay._closeHandler = null; }
  }

  /**
   * Custom dialog replacing native prompt()/confirm() (which look out of place
   * and are blocked in some installed PWAs). Stacks above the main modal.
   * Returns a Promise: text for input dialogs (null on cancel), boolean otherwise.
   */
  _dialog({ title, message, input = false, defaultValue = '', confirmLabel = 'OK', cancelLabel = 'Отмена', danger = false } = {}) {
    return new Promise(resolve => {
      const overlay = _mkEl('div', 'modal-overlay');
      overlay.style.zIndex = '300';   // above the main modal-overlay (200)
      const box = _mkEl('div', 'modal-content');
      box.style.maxWidth = '400px';

      if (title) { const t = _mkEl('div', 'modal-title'); t.textContent = title; box.appendChild(t); }
      if (message) {
        const p = _mkEl('p');
        p.style.cssText = 'color:var(--ui-text);font-size:14px;line-height:1.5;margin-bottom:4px;';
        p.textContent = message;
        box.appendChild(p);
      }

      let inputEl = null;
      if (input) {
        const fg = _mkEl('div', 'form-group');
        fg.style.marginTop = '12px';
        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.className = 'form-input';
        inputEl.value = defaultValue;
        inputEl.maxLength = 40;
        fg.appendChild(inputEl);
        box.appendChild(fg);
      }

      const actions = _mkEl('div', 'modal-actions');
      const cancelBtn = _mkEl('button', 'btn btn-secondary'); cancelBtn.textContent = cancelLabel;
      const okBtn = _mkEl('button', 'btn ' + (danger ? 'btn-danger' : 'btn-primary')); okBtn.textContent = confirmLabel;
      actions.appendChild(cancelBtn); actions.appendChild(okBtn);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const close = result => { overlay.remove(); resolve(result); };
      const cancelValue = input ? null : false;
      cancelBtn.addEventListener('click', () => close(cancelValue));
      okBtn.addEventListener('click', () => close(input ? inputEl.value : true));
      overlay.addEventListener('click', e => { if (e.target === overlay) close(cancelValue); });

      if (inputEl) {
        inputEl.addEventListener('keydown', e => {
          if (e.key === 'Enter')  { e.preventDefault(); okBtn.click(); }
          if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
        });
        setTimeout(() => { inputEl.focus(); inputEl.select(); }, 0);
      } else {
        setTimeout(() => okBtn.focus(), 0);
      }
    });
  }

  _confirm(message, { confirmLabel = 'OK', danger = false } = {}) {
    return this._dialog({ message, confirmLabel, danger });
  }

  _prompt(title, defaultValue = '', confirmLabel = 'Сохранить') {
    return this._dialog({ title, input: true, defaultValue, confirmLabel });
  }

  showSaveDialog() {
    const slots = getSlots();
    const wrap  = _mkEl('div');
    const title = _mkEl('div', 'modal-title');
    title.textContent = 'Сохранить рисунок';
    wrap.appendChild(title);

    const grid = _mkEl('div', 'save-slots');
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = slots[i];
      const card = _mkEl('div', 'save-slot' + (slot ? '' : ' empty'));
      const thumb = _mkEl('div', 'slot-thumb');
      if (slot?.thumbnail) { const img = document.createElement('img'); img.src = slot.thumbnail; img.alt = 'Слот ' + (i+1); thumb.appendChild(img); }
      else { const icon = _mkEl('div', 'empty-icon'); icon.textContent = '＋'; thumb.appendChild(icon); }
      card.appendChild(thumb);
      const info = _mkEl('div', 'slot-info');
      const nm = _mkEl('div', 'slot-name'); nm.textContent = slot ? slot.name : `Слот ${i+1}`;
      const dt = _mkEl('div', 'slot-date'); dt.textContent = slot ? formatDate(slot.savedAt) : 'Пусто';
      info.appendChild(nm); info.appendChild(dt); card.appendChild(info);
      const acts = _mkEl('div', 'slot-actions');
      const saveBtn = _mkEl('button', 'btn btn-primary'); saveBtn.textContent = 'Сохранить';
      saveBtn.addEventListener('click', () => this._doSave(i));
      acts.appendChild(saveBtn);
      if (slot) {
        const delBtn = _mkEl('button', 'btn btn-secondary'); delBtn.textContent = '✕'; delBtn.title = 'Очистить слот';
        delBtn.addEventListener('click', async e => {
          e.stopPropagation();
          if (await this._confirm(`Удалить «${slot.name}»?`, { confirmLabel: 'Удалить', danger: true })) {
            deleteSlot(i); this._hideModal(); this.showSaveDialog();
          }
        });
        acts.appendChild(delBtn);
      }
      card.appendChild(acts); grid.appendChild(card);
    }
    wrap.appendChild(grid);
    const closeBtn = _mkEl('button', 'btn btn-secondary'); closeBtn.textContent = 'Закрыть'; closeBtn.style.marginTop = '16px';
    closeBtn.addEventListener('click', () => this._hideModal());
    wrap.appendChild(closeBtn);
    this._showModal(wrap);
  }

  async _doSave(i) {
    const existing = getSlots()[i];
    const defaultName = existing?.name || `Рисунок ${i+1}`;
    const name = await this._prompt('Название рисунка', defaultName);
    if (name === null) return;
    const finalName = name.trim() || defaultName;
    const ok = saveSlot(i, finalName, this.renderer.grid, this.renderer.renderThumbnail());
    this._hideModal();
    if (!ok) {
      this._toast('⚠ Не удалось сохранить: хранилище переполнено или недоступно');
      return;
    }
    this._toast(`Сохранено в слот ${i+1}: «${finalName}»`);
  }

  showLoadDialog() {
    const slots = getSlots();
    const wrap  = _mkEl('div');
    const title = _mkEl('div', 'modal-title'); title.textContent = 'Загрузить рисунок'; wrap.appendChild(title);
    if (!slots.some(Boolean)) {
      const empty = _mkEl('p'); empty.style.cssText = 'color:var(--ui-text-muted);margin:20px 0;text-align:center;';
      empty.textContent = 'Нет сохранённых рисунков.'; wrap.appendChild(empty);
    } else {
      const grid = _mkEl('div', 'save-slots');
      for (let i = 0; i < SLOT_COUNT; i++) {
        const slot = slots[i]; if (!slot) continue;
        const card = _mkEl('div', 'save-slot');
        const thumb = _mkEl('div', 'slot-thumb');
        if (slot.thumbnail) { const img = document.createElement('img'); img.src = slot.thumbnail; img.alt = slot.name; thumb.appendChild(img); }
        card.appendChild(thumb);
        const info = _mkEl('div', 'slot-info');
        const nm = _mkEl('div', 'slot-name'); nm.textContent = slot.name;
        const dt = _mkEl('div', 'slot-date'); dt.textContent = formatDate(slot.savedAt);
        info.appendChild(nm); info.appendChild(dt); card.appendChild(info);
        const acts = _mkEl('div', 'slot-actions');
        const loadBtn = _mkEl('button', 'btn btn-primary'); loadBtn.textContent = 'Загрузить';
        loadBtn.addEventListener('click', () => this._doLoad(i));
        acts.appendChild(loadBtn); card.appendChild(acts); grid.appendChild(card);
      }
      wrap.appendChild(grid);
    }
    const closeBtn = _mkEl('button', 'btn btn-secondary'); closeBtn.textContent = 'Закрыть'; closeBtn.style.marginTop = '16px';
    closeBtn.addEventListener('click', () => this._hideModal()); wrap.appendChild(closeBtn);
    this._showModal(wrap);
  }

  async _doLoad(i) {
    const data = loadSlot(i); if (!data) return;
    if (!await this._confirm(`Загрузить «${data.name}»? Несохранённые изменения будут потеряны.`, { confirmLabel: 'Загрузить' })) return;
    this.renderer.grid.set(data.grid);
    this.renderer.applyCells([]);
    this.renderer.forceRender();
    this.tools.clearHistory();
    this._hideModal();
    this._toast(`Загружено: «${data.name}»`);
    this._renderMinimap();
    this._updateStatusBar();
  }

  showExportDialog() {
    const wrap = _mkEl('div');
    const title = _mkEl('div', 'modal-title'); title.textContent = 'Экспорт PNG'; wrap.appendChild(title);
    const opts = _mkEl('div', 'print-options');
    const gridOpt = _mkCheckbox('export-grid', 'Включить линии сетки', true);
    opts.appendChild(gridOpt.wrap); wrap.appendChild(opts);
    const actions = _mkEl('div', 'modal-actions');
    const cancelBtn = _mkEl('button', 'btn btn-secondary'); cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', () => this._hideModal());
    const exportBtn = _mkEl('button', 'btn btn-primary'); exportBtn.textContent = '⬇ Скачать PNG';
    exportBtn.addEventListener('click', () => { exportPNG(this.renderer, gridOpt.input.checked); this._hideModal(); });
    actions.appendChild(cancelBtn); actions.appendChild(exportBtn); wrap.appendChild(actions);
    this._showModal(wrap);
  }

  showPrintDialog() {
    const wrap = _mkEl('div');
    const title = _mkEl('div', 'modal-title'); title.textContent = 'Печать'; wrap.appendChild(title);
    const opts = _mkEl('div', 'print-options');
    const gridOpt = _mkCheckbox('print-grid', 'Включить линии сетки', true);
    opts.appendChild(gridOpt.wrap); wrap.appendChild(opts);
    const actions = _mkEl('div', 'modal-actions');
    const cancelBtn = _mkEl('button', 'btn btn-secondary'); cancelBtn.textContent = 'Отмена';
    cancelBtn.addEventListener('click', () => this._hideModal());
    const printBtn = _mkEl('button', 'btn btn-primary'); printBtn.textContent = '🖸 Распечатать';
    printBtn.addEventListener('click', () => { printSheet(this.renderer, gridOpt.input.checked); this._hideModal(); });
    actions.appendChild(cancelBtn); actions.appendChild(printBtn); wrap.appendChild(actions);
    this._showModal(wrap);
  }

  _toast(msg, duration = 2800) {
    let el = document.getElementById('_toast');
    if (!el) {
      el = document.createElement('div'); el.id = '_toast';
      Object.assign(el.style, {
        position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(30,25,20,.85)', color: '#fff',
        padding: '9px 20px', borderRadius: '20px', fontSize: '13px',
        zIndex: '9999', pointerEvents: 'none', transition: 'opacity .25s',
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = '0'; }, duration);
  }
}

function _el(id)         { return document.getElementById(id); }
function _on(id, ev, fn) { _el(id)?.addEventListener(ev, fn); }
function _setText(id, t) { const el = _el(id); if (el) el.textContent = t; }
function _mkEl(tag, cls) { const el = document.createElement(tag); if (cls) el.className = cls; return el; }
function _mkCheckbox(id, label, checked = false) {
  const wrap  = _mkEl('label', 'print-option');
  const input = document.createElement('input');
  input.type = 'checkbox'; input.id = id; input.checked = checked;
  const lbl = _mkEl('label'); lbl.setAttribute('for', id); lbl.textContent = label;
  wrap.appendChild(input); wrap.appendChild(lbl);
  return { wrap, input };
}