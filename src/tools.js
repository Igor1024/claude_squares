/**
 * tools.js — Drawing tools, pointer event handling, and undo/redo history.
 */

import { COLS } from './canvas.js';

const MAX_HISTORY = 50;

// ── History ──────────────────────────────────────────────────────────────────────────────

class History {
  constructor() {
    this._steps   = [];   // Array of diffs: [{idx, from, to}]
    this._cursor  = -1;   // points to the last committed step
  }

  /** Push a completed stroke diff onto the stack, truncating any redo history. */
  push(diff) {
    if (!diff.length) return;
    this._steps = this._steps.slice(0, this._cursor + 1);
    this._steps.push(diff);
    if (this._steps.length > MAX_HISTORY) this._steps.shift();
    else this._cursor++;
  }

  /** Undo last step; returns the cells to restore, or null. */
  undo() {
    if (this._cursor < 0) return null;
    const diff = this._steps[this._cursor--];
    return diff.map(d => ({ idx: d.idx, value: d.from }));
  }

  /** Redo next step; returns the cells to apply, or null. */
  redo() {
    if (this._cursor >= this._steps.length - 1) return null;
    const diff = this._steps[++this._cursor];
    return diff.map(d => ({ idx: d.idx, value: d.to }));
  }

  canUndo() { return this._cursor >= 0; }
  canRedo() { return this._cursor < this._steps.length - 1; }

  clear() { this._steps = []; this._cursor = -1; }
}

// ── ToolController ─────────────────────────────────────────────────────────────────────────────

export class ToolController {
  constructor(canvasEl, renderer, callbacks = {}) {
    this.canvas   = canvasEl;
    this.renderer = renderer;
    this.onCellHover  = callbacks.onCellHover  ?? (() => {});
    this.onChange     = callbacks.onChange     ?? (() => {});
    this.onToolChange  = callbacks.onToolChange  ?? (() => {});
    this.onColorChange = callbacks.onColorChange ?? (() => {});

    this.tool  = 'pen';    // 'pen' | 'eraser'
    this.color = 1;        // 1=black 2=blue 3=red

    this._history = new History();

    // Per-stroke tracking
    this._strokeOriginals = new Map(); // idx → original value before stroke
    this._strokeModified  = new Set(); // idx values modified in current stroke

    // Pointer state
    this._pointers = new Map();  // pointerId → {x, y}
    this._isDrawing = false;
    this._isPanning = false;
    this._lastPanCentroid = null;
    this._pinchDist = 0;
    this._spaceDown = false;

    this._bindEvents();
  }

  setTool(t) { this.tool = t; this.onToolChange(t); this._updateCursor(); }
  setColor(c) { this.color = c; this.onColorChange(c); }
  getCurrentTool()  { return this.tool; }
  getCurrentColor() { return this.color; }
  canUndo() { return this._history.canUndo(); }
  canRedo() { return this._history.canRedo(); }

  undo() {
    const cells = this._history.undo();
    if (!cells) return;
    this.renderer.applyCells(cells);
    this.onChange();
  }

  redo() {
    const cells = this._history.redo();
    if (!cells) return;
    this.renderer.applyCells(cells);
    this.onChange();
  }

  clearHistory() { this._history.clear(); }

  _bindEvents() {
    const el = this.canvas;
    el.addEventListener('pointerdown',   e => this._onDown(e),   { passive: false });
    el.addEventListener('pointermove',   e => this._onMove(e),   { passive: false });
    el.addEventListener('pointerup',     e => this._onUp(e),     { passive: false });
    el.addEventListener('pointercancel', e => this._onUp(e),     { passive: false });
    el.addEventListener('wheel',         e => this._onWheel(e),  { passive: false });
    el.addEventListener('contextmenu',   e => e.preventDefault());

    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        this._spaceDown = true;
        this._updateCursor();
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space') { this._spaceDown = false; this._updateCursor(); }
    });
  }

  _updateCursor() {
    this.canvas.classList.toggle('pan-cursor',    this._spaceDown || this._isPanning);
    this.canvas.classList.toggle('eraser-cursor', !this._spaceDown && this.tool === 'eraser');
    this.canvas.classList.remove('grabbing-cursor');
  }

  _onDown(e) {
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch {}
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 1) {
      const { x, y } = this._canvasPos(e);
      if (e.button === 1 || e.button === 2 || this._spaceDown) {
        this._isPanning = true;
        this._lastPanCentroid = { x: e.clientX, y: e.clientY };
        this.canvas.classList.add('grabbing-cursor');
        return;
      }
      const cell = this.renderer.getCellAt(x, y);
      if (cell) {
        this._isDrawing = true;
        this._applyCell(cell.col, cell.row);
      } else {
        this._isPanning = true;
        this._lastPanCentroid = { x: e.clientX, y: e.clientY };
        this.canvas.classList.add('grabbing-cursor');
      }
    } else if (this._pointers.size === 2) {
      if (this._isDrawing) this._commitStroke();
      this._isDrawing = false;
      this._isPanning = true;
      const pts = [...this._pointers.values()];
      this._pinchDist = this._dist(pts[0], pts[1]);
      this._lastPanCentroid = this._centroid(pts);
    }
  }

  _onMove(e) {
    e.preventDefault();
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._isDrawing && this._pointers.size === 1) {
      const { x, y } = this._canvasPos(e);
      const cell = this.renderer.getCellAt(x, y);
      if (cell) this._applyCell(cell.col, cell.row);
      this.onCellHover(cell?.col ?? null, cell?.row ?? null);
    } else if (this._isPanning) {
      const pts = [...this._pointers.values()];
      if (pts.length >= 2) {
        const c = this._centroid(pts);
        if (this._lastPanCentroid) {
          this.renderer.pan(c.x - this._lastPanCentroid.x, c.y - this._lastPanCentroid.y);
        }
        this._lastPanCentroid = c;
        const newDist = this._dist(pts[0], pts[1]);
        if (this._pinchDist > 0) this.renderer.zoom(newDist / this._pinchDist, c.x, c.y);
        this._pinchDist = newDist;
      } else if (pts.length === 1 && this._lastPanCentroid) {
        const p = pts[0];
        this.renderer.pan(p.x - this._lastPanCentroid.x, p.y - this._lastPanCentroid.y);
        this._lastPanCentroid = { ...p };
      }
    } else {
      const { x, y } = this._canvasPos(e);
      const cell = this.renderer.getCellAt(x, y);
      this.onCellHover(cell?.col ?? null, cell?.row ?? null);
    }
  }

  _onUp(e) {
    this._pointers.delete(e.pointerId);
    if (this._pointers.size === 0) {
      if (this._isDrawing) this._commitStroke();
      this._isDrawing = false;
      this._isPanning = false;
      this._lastPanCentroid = null;
      this._pinchDist = 0;
      this._updateCursor();
    } else if (this._pointers.size === 1) {
      const [p] = this._pointers.values();
      this._lastPanCentroid = { x: p.x, y: p.y };
      this._pinchDist = 0;
    }
  }

  _onWheel(e) {
    e.preventDefault();
    const { x, y } = this._canvasPos(e);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.renderer.zoom(factor, x, y);
    this.onChange();
  }

  _applyCell(col, row) {
    const idx    = row * COLS + col;
    const newVal = this.tool === 'pen' ? this.color : 0;
    if (!this._strokeOriginals.has(idx)) {
      this._strokeOriginals.set(idx, this.renderer.grid[idx]);
    }
    if (this.renderer.grid[idx] !== newVal) {
      this.renderer.setCell(col, row, newVal);
      this._strokeModified.add(idx);
      this.onChange();
    }
  }

  _commitStroke() {
    if (!this._strokeModified.size) { this._strokeOriginals.clear(); return; }
    const diff = [];
    for (const idx of this._strokeModified) {
      diff.push({ idx, from: this._strokeOriginals.get(idx), to: this.renderer.grid[idx] });
    }
    this._history.push(diff);
    this._strokeOriginals.clear();
    this._strokeModified.clear();
    this.onChange();
  }

  _canvasPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  _dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
  _centroid(pts) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }
}