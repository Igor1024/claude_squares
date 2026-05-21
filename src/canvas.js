/**
 * canvas.js — Grid rendering engine
 * Manages cell data, zoom/pan, and canvas drawing.
 */

export const COLS = 42;
export const ROWS = 59;
export const TOTAL_CELLS = COLS * ROWS;

// 5mm at 96 CSS dpi
export const REAL_CELL_SIZE = Math.round(5 * 96 / 25.4); // ≈19px

const PAPER_COLOR   = '#fdf8f0';
const GRID_COLOR    = '#9ac4e8';
const BG_COLOR      = '#ddd8cc';
const BORDER_COLOR  = '#7aadc8';

const COLOR_MAP = {
  0: null,
  1: '#1a1a2e',  // black ink
  2: '#1a3a8f',  // blue ink
  3: '#c0392b',  // red ink
};

// Maximum zoom: 2× real scale
const MAX_CELL_SIZE = REAL_CELL_SIZE * 2;

export class CanvasRenderer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx    = canvasEl.getContext('2d');

    // Cell data: 0=empty, 1=black, 2=blue, 3=red
    this.grid = new Uint8Array(TOTAL_CELLS);

    this.cellSize = 10;   // CSS pixels per cell
    this.offsetX  = 0;    // sheet origin X in canvas CSS pixels
    this.offsetY  = 0;

    this.viewWidth  = 0;
    this.viewHeight = 0;
    this.dpr = window.devicePixelRatio || 1;

    // Track whether we're in "fit to screen" mode
    this._fitMode = true;

    // Ink-spread animations: Map<idx, {progress: 0..1}>
    this._anims = new Map();

    this._rafId     = null;
    this._needRender = false;
  }

  /** Resize canvas to new CSS pixel dimensions. */
  resize(w, h) {
    this.viewWidth  = w;
    this.viewHeight = h;
    const dpr = this.dpr;
    this.canvas.width  = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width  = w + 'px';
    this.canvas.style.height = h + 'px';
    // Scale once; all drawing thereafter uses CSS coordinates
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._scheduleRender();
  }

  /** Fit the entire A4 sheet into the viewport with a small margin. */
  fitToScreen(w, h) {
    w = w ?? this.viewWidth;
    h = h ?? this.viewHeight;
    if (!w || !h) return this.cellSize;
    const margin = 12;
    this.cellSize = Math.min((w - margin * 2) / COLS, (h - margin * 2) / ROWS);
    this._centerSheet();
    this._fitMode = true;
    this._scheduleRender();
    return this.cellSize;
  }

  /** True when the sheet is displayed at fit-to-screen scale. */
  isFitToScreen() {
    return this._fitMode;
  }

  /** Compute the cellSize that fits the sheet perfectly. */
  _fitCellSize() {
    const margin = 12;
    return Math.min(
      (this.viewWidth  - margin * 2) / COLS,
      (this.viewHeight - margin * 2) / ROWS
    );
  }

  /** Center the sheet in the viewport. */
  _centerSheet() {
    this.offsetX = (this.viewWidth  - this.cellSize * COLS) / 2;
    this.offsetY = (this.viewHeight - this.cellSize * ROWS) / 2;
  }

  /**
   * Zoom by `factor` keeping the canvas point (pivotX, pivotY) stationary.
   * Returns the new cellSize.
   */
  zoom(factor, pivotX, pivotY) {
    const minSize = this._fitCellSize();
    const newSize = Math.max(minSize, Math.min(MAX_CELL_SIZE, this.cellSize * factor));
    if (Math.abs(newSize - this.cellSize) < 0.01) return this.cellSize;

    const ratio = newSize / this.cellSize;
    this.offsetX = pivotX - ratio * (pivotX - this.offsetX);
    this.offsetY = pivotY - ratio * (pivotY - this.offsetY);
    this.cellSize = newSize;
    this._fitMode = Math.abs(this.cellSize - this._fitCellSize()) < 0.5;
    this._clampOffset();
    this._scheduleRender();
    return this.cellSize;
  }

  /** Pan the sheet by (dx, dy) CSS pixels. */
  pan(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
    this._clampOffset();
    this._scheduleRender();
  }

  /** Keep the sheet from flying completely off screen. */
  _clampOffset() {
    if (!this.viewWidth || !this.viewHeight) return;
    const sw = this.cellSize * COLS;
    const sh = this.cellSize * ROWS;
    const margin = 60; // px of sheet that must stay visible
    this.offsetX = Math.max(-(sw - margin), Math.min(this.viewWidth  - margin, this.offsetX));
    this.offsetY = Math.max(-(sh - margin), Math.min(this.viewHeight - margin, this.offsetY));
  }

  /** Return current zoom as percentage of real-world scale (100% = 5mm/cell). */
  getZoomPercent() {
    return Math.round(this.cellSize / REAL_CELL_SIZE * 100);
  }

  // ── Cell access ──────────────────────────────────────────────

  getCell(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return 0;
    return this.grid[row * COLS + col];
  }

  /**
   * Set a cell value and schedule a re-render.
   * Returns true if the value actually changed.
   */
  setCell(col, row, value) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    const idx = row * COLS + col;
    if (this.grid[idx] === value) return false;
    this.grid[idx] = value;
    // Start ink-spread animation for new fills
    if (value > 0) this._anims.set(idx, { progress: 0 });
    this._scheduleRender();
    return true;
  }

  /** Bulk-set cells without animation (used by undo/redo). */
  applyCells(diffs) {
    for (const { idx, value } of diffs) {
      this.grid[idx] = value;
    }
    this._anims.clear();
    this._scheduleRender();
  }

  /**
   * Convert canvas CSS coordinates to cell {col, row}.
   * Returns null when outside the sheet.
   */
  getCellAt(x, y) {
    const col = Math.floor((x - this.offsetX) / this.cellSize);
    const row = Math.floor((y - this.offsetY) / this.cellSize);
    if (col >= 0 && col < COLS && row >= 0 && row < ROWS) return { col, row };
    return null;
  }

  /** Viewport extent in cell coordinates (for minimap). */
  getViewportCellRect() {
    const x = Math.max(0, (-this.offsetX) / this.cellSize);
    const y = Math.max(0, (-this.offsetY) / this.cellSize);
    const w = Math.min(COLS, this.viewWidth  / this.cellSize);
    const h = Math.min(ROWS, this.viewHeight / this.cellSize);
    return { x, y, w: Math.min(w, COLS - x), h: Math.min(h, ROWS - y) };
  }

  // ── Counting ──────────────────────────────────────────────────

  getFilledCount() {
    let n = 0;
    for (let i = 0; i < TOTAL_CELLS; i++) if (this.grid[i]) n++;
    return n;
  }

  // ── Rendering ────────────────────────────────────────────────

  _scheduleRender() {
    this._needRender = true;
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        this._render();
      });
    }
  }

  forceRender() {
    this._render();
  }

  _render() {
    const ctx = this.ctx;
    const { viewWidth: vw, viewHeight: vh } = this;
    const { cellSize: cs, offsetX: ox, offsetY: oy } = this;

    // Outer background (outside the sheet)
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, vw, vh);

    // Sheet shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(ox + 5, oy + 5, COLS * cs, ROWS * cs);

    // Paper background
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(ox, oy, COLS * cs, ROWS * cs);

    // Visible cell range (viewport culling)
    const startCol = Math.max(0, Math.floor(-ox / cs));
    const endCol   = Math.min(COLS - 1, Math.ceil((vw - ox) / cs));
    const startRow = Math.max(0, Math.floor(-oy / cs));
    const endRow   = Math.min(ROWS - 1, Math.ceil((vh - oy) / cs));

    // Draw filled cells
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const idx = r * COLS + c;
        const val = this.grid[idx];
        if (!val) continue;

        const cx = ox + c * cs;
        const cy = oy + r * cs;
        const anim = this._anims.get(idx);

        ctx.fillStyle = COLOR_MAP[val];

        if (anim && anim.progress < 1) {
          // Ink-spread: scale from center
          const p   = anim.progress;
          const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
          const scale = 0.25 + 0.75 * ease;
          const hw = (cs * scale) / 2 - 0.5;
          const mid = cs / 2;
          ctx.fillRect(cx + mid - hw, cy + mid - hw, hw * 2, hw * 2);
        } else {
          // Inset slightly so grid lines stay visible
          ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
          if (anim) this._anims.delete(idx);
        }
      }
    }

    // Grid lines (drawn on top of cells so they're always visible)
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();

    for (let c = startCol; c <= endCol + 1; c++) {
      const x = Math.round(ox + c * cs) + 0.5;
      ctx.moveTo(x, Math.round(oy + startRow * cs));
      ctx.lineTo(x, Math.round(oy + (endRow + 1) * cs));
    }
    for (let r = startRow; r <= endRow + 1; r++) {
      const y = Math.round(oy + r * cs) + 0.5;
      ctx.moveTo(Math.round(ox + startCol * cs), y);
      ctx.lineTo(Math.round(ox + (endCol + 1) * cs), y);
    }
    ctx.stroke();

    // Sheet border (slightly darker)
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(ox) + 0.5, Math.round(oy) + 0.5, COLS * cs, ROWS * cs);

    // Advance animations; reschedule if any are still running
    let stillAnimating = false;
    for (const [idx, anim] of this._anims) {
      anim.progress = Math.min(1, anim.progress + 0.12);
      if (anim.progress < 1) stillAnimating = true;
    }
    if (stillAnimating) this._scheduleRender();

    this._needRender = false;
  }

  // ── Off-screen rendering ───────────────────────────────────────────────

  /**
   * Render the full grid at real-world scale to an offscreen canvas.
   * Used for PNG export.
   */
  renderToOffscreen(includeGrid = true) {
    const cs = REAL_CELL_SIZE;
    const w  = COLS * cs;
    const h  = ROWS * cs;
    const off = document.createElement('canvas');
    off.width  = w;
    off.height = h;
    const ctx = off.getContext('2d');

    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, w, h);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = this.grid[r * COLS + c];
        if (val) {
          ctx.fillStyle = COLOR_MAP[val];
          ctx.fillRect(c * cs + 1, r * cs + 1, cs - 2, cs - 2);
        }
      }
    }

    if (includeGrid) {
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let c = 0; c <= COLS; c++) { ctx.moveTo(c * cs + 0.5, 0); ctx.lineTo(c * cs + 0.5, h); }
      for (let r = 0; r <= ROWS; r++) { ctx.moveTo(0, r * cs + 0.5); ctx.lineTo(w, r * cs + 0.5); }
      ctx.stroke();

      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    }

    return off;
  }

  /**
   * Render a small thumbnail of the grid (COLS*scale × ROWS*scale px).
   * Returns a data URL.
   */
  renderThumbnail(scale = 3) {
    const w = COLS * scale;
    const h = ROWS * scale;
    const off = document.createElement('canvas');
    off.width  = w;
    off.height = h;
    const ctx = off.getContext('2d');

    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, w, h);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = this.grid[r * COLS + c];
        if (val) {
          ctx.fillStyle = COLOR_MAP[val];
          ctx.fillRect(c * scale, r * scale, scale, scale);
        }
      }
    }
    return off.toDataURL('image/png', 0.8);
  }

  /**
   * Render the minimap onto the given canvas element.
   */
  renderMinimap(minimapCanvas) {
    const mw  = minimapCanvas.width;
    const mh  = minimapCanvas.height;
    const ctx = minimapCanvas.getContext('2d');
    const sx  = mw / COLS;
    const sy  = mh / ROWS;

    ctx.clearRect(0, 0, mw, mh);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, mw, mh);

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const val = this.grid[r * COLS + c];
        if (val) {
          ctx.fillStyle = COLOR_MAP[val];
          ctx.fillRect(
            Math.floor(c * sx), Math.floor(r * sy),
            Math.ceil(sx) + 1,  Math.ceil(sy) + 1
          );
        }
      }
    }

    // Grid border on minimap
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(0.5, 0.5, mw - 1, mh - 1);
  }
}