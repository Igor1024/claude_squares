/**
 * app.js — Main application controller.
 * Initialises all modules and orchestrates their interaction.
 */

import { CanvasRenderer, TOTAL_CELLS }  from './canvas.js';
import { ToolController }               from './tools.js';
import { UI }                           from './ui.js';
import { showFirstVisit, showWelcomeBack } from './onboarding.js';
import { autosave, isFirstVisit, getAutosave } from './storage.js';
import { initPWA, onUpdateAvailable, applyUpdate } from './pwa.js';

class App {
  constructor() {
    this.renderer = null;
    this.tools    = null;
    this.ui       = null;
    this._autosaveTimer = null;
  }

  async init() {
    initPWA();
    onUpdateAvailable(() => this._showUpdateBanner());

    document.getElementById('update-btn')?.addEventListener('click', () => applyUpdate());
    document.getElementById('update-dismiss')?.addEventListener('click', () => {
      document.getElementById('update-banner').classList.add('hidden');
    });

    window.addEventListener('keydown', e => this._onKeyDown(e));

    if (isFirstVisit()) {
      await showFirstVisit();
    } else {
      const result = await showWelcomeBack();
      if (result.loadAutosave) this._pendingAutosave = getAutosave();
    }

    this._startApp();
  }

  _startApp() {
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('onboarding').classList.add('hidden');

    this._initCanvas();
    this._initTools();
    this._initUI();

    if (this._pendingAutosave) {
      this.renderer.grid.set(this._pendingAutosave.grid);
      this.renderer.forceRender();
    }

    this._startAutosave();
  }

  _initCanvas() {
    const canvasEl = document.getElementById('main-canvas');
    const viewport = document.getElementById('canvas-viewport');
    this.renderer  = new CanvasRenderer(canvasEl);

    // ResizeObserver handles both initial sizing and subsequent resizes.
    // It fires with correct dimensions even when the element just became visible.
    new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width: w, height: h } = entry.contentRect;
        if (!w || !h) continue;
        const wasFit = this.renderer.isFitToScreen();
        this.renderer.resize(w, h);
        if (wasFit) this.renderer.fitToScreen(w, h);
        this.ui?._renderMinimap();
      }
    }).observe(viewport);
  }

  _initTools() {
    this.tools = new ToolController(
      document.getElementById('main-canvas'),
      this.renderer,
      {
        onCellHover:   (col, row) => this.ui?.updateCoords(col, row),
        onChange:      ()         => this.ui?.onGridChange(),
        onToolChange:  ()         => {},
        onColorChange: ()         => {},
      }
    );
  }

  _initUI() {
    this.ui = new UI(this, this.renderer, this.tools);
    this.ui.init();
    this.ui.onGridChange();
  }

  _startAutosave() {
    this._autosaveTimer = setInterval(() => {
      const thumb = this.renderer.renderThumbnail();
      autosave(this.renderer.grid, thumb);
    }, 30_000);
  }

  _onKeyDown(e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.tools.undo(); this.ui._updateUndoRedo(); return; }
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); this.tools.redo(); this.ui._updateUndoRedo(); return; }
    if (ctrl && e.key === 's') { e.preventDefault(); this.ui.showSaveDialog(); return; }
    if (e.key === 'p' || e.key === 'P') { this.ui._selectTool('pen'); return; }
    if (e.key === 'e' || e.key === 'E') { this.ui._selectTool('eraser'); return; }
    if (e.key === '+' || e.key === '=') { this.ui._zoomCenter(1.25); }
    else if (e.key === '-' || e.key === '_') { this.ui._zoomCenter(1 / 1.25); }
    else if (e.key === '0') { this.renderer.fitToScreen(); this.ui._updateZoom(); this.ui._renderMinimap(); }
  }

  _showUpdateBanner() {
    document.getElementById('update-banner').classList.remove('hidden');
  }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());