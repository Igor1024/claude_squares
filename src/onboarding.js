/**
 * onboarding.js — First-visit intro, nickname prompt, interactive tutorial,
 *                 and welcome-back screen.
 */

import { getNickname, saveNickname, markVisited, getAutosave, formatDate } from './storage.js';

export function showFirstVisit() {
  return new Promise(resolve => {
    const overlay = document.getElementById('onboarding');
    overlay.classList.remove('hidden');
    overlay.innerHTML = '';

    const done = (nickname, withTutorial) => {
      if (withTutorial) {
        _showTutorial(overlay, () => resolve({ nickname, loadAutosave: false }));
      } else {
        overlay.classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        resolve({ nickname, loadAutosave: false });
      }
    };

    overlay.appendChild(_buildIntroCard(
      nickname => done(nickname, true),
      nickname => done(nickname, false)
    ));
  });
}

export function showWelcomeBack() {
  return new Promise(resolve => {
    const overlay = document.getElementById('onboarding');
    overlay.classList.remove('hidden');
    overlay.innerHTML = '';
    const nickname = getNickname() || 'художник';
    const autosave = getAutosave();
    overlay.appendChild(_buildWelcomeCard(nickname, autosave, result => {
      overlay.classList.add('hidden');
      resolve(result);
    }));
  });
}

function _buildIntroCard(onStart, onSkip) {
  const card = _el('div', 'intro-card');

  const gridDiv = _el('div', 'intro-grid');
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = 180; previewCanvas.height = 140;
  gridDiv.appendChild(previewCanvas); card.appendChild(gridDiv);
  _drawPreviewArt(previewCanvas);

  const title = _el('h1', 'app-title');
  title.textContent = 'Пиксель-арт\nна клетчатой бумаге';
  title.style.whiteSpace = 'pre-line';
  card.appendChild(title);

  const sub = _el('p', 'app-subtitle');
  sub.textContent = 'Рисуй на виртуальной тетради в клетку.\nСохраняй, экспортируй, распечатывай.';
  sub.style.whiteSpace = 'pre-line';
  card.appendChild(sub);

  const form = _el('div', 'form-group');
  const label = _el('label', 'form-label');
  label.textContent = 'Как тебя зовут?'; label.setAttribute('for', 'nickname-input');
  const input = document.createElement('input');
  input.type = 'text'; input.id = 'nickname-input'; input.className = 'form-input';
  input.placeholder = 'Твоё имя или ник'; input.maxLength = 24;
  form.appendChild(label); form.appendChild(input); card.appendChild(form);

  const errMsg = _el('p');
  errMsg.style.cssText = 'color:#c0392b;font-size:12px;margin-top:-8px;margin-bottom:12px;min-height:16px;';
  card.appendChild(errMsg);

  const actions = _el('div', 'modal-actions');
  actions.style.justifyContent = 'center'; actions.style.gap = '12px';
  const skipBtn = _el('button', 'btn btn-secondary'); skipBtn.textContent = 'Пропустить обучение';
  const startBtn = _el('button', 'btn btn-primary'); startBtn.textContent = 'Начать →';
  actions.appendChild(skipBtn); actions.appendChild(startBtn); card.appendChild(actions);

  input.addEventListener('keydown', e => { if (e.key === 'Enter') startBtn.click(); });
  setTimeout(() => input.focus(), 100);

  startBtn.addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) { errMsg.textContent = 'Введи хотя бы одну букву 😊'; input.focus(); return; }
    errMsg.textContent = ''; saveNickname(val); markVisited(); onStart(val);
  });
  skipBtn.addEventListener('click', () => {
    const val = input.value.trim() || 'художник';
    saveNickname(val); markVisited(); onSkip(val);
  });

  return card;
}

function _buildWelcomeCard(nickname, autosave, onResolve) {
  const card = _el('div', 'welcome-card');
  const greeting = _el('h2', 'greeting');
  greeting.textContent = `С возвращением, ${nickname}!`;
  card.appendChild(greeting);

  if (autosave) {
    const sub = _el('p', 'subtitle'); sub.textContent = `Последнее автосохранение: ${formatDate(autosave.savedAt)}`; card.appendChild(sub);
    if (autosave.thumbnail) {
      const tw = _el('div', 'autosave-thumb');
      const img = document.createElement('img'); img.src = autosave.thumbnail; img.alt = 'Предпросмотр';
      tw.appendChild(img); card.appendChild(tw);
    }
  } else {
    const sub = _el('p', 'subtitle'); sub.textContent = 'Начни новый рисунок или продолжи сохранённый.'; card.appendChild(sub);
  }

  const actions = _el('div', 'welcome-actions'); card.appendChild(actions);
  if (autosave) {
    const btn = _el('button', 'btn btn-primary'); btn.textContent = '▶ Продолжить рисование';
    btn.addEventListener('click', () => onResolve({ loadAutosave: true })); actions.appendChild(btn);
  }
  const newBtn = _el('button', 'btn btn-secondary');
  newBtn.textContent = autosave ? '✦ Начать новый рисунок' : '✦ Начать рисовать';
  newBtn.addEventListener('click', () => onResolve({ loadAutosave: false })); actions.appendChild(newBtn);
  return card;
}

const TUTORIAL_STEPS = [
  { targetId: 'tool-pen',    mobileTargetId: 'm-tool-pen',    title: 'Инструмент «Ручка»', text: 'Кликай или тяни по клеткам, чтобы закрашивать их. Это твой основной инструмент.' },
  { targetId: 'tool-eraser', mobileTargetId: 'm-tool-eraser', title: 'Ластик',         text: 'Стирает закрашенные клетки. Так же работает перетаскиванием.' },
  { targetId: 'color-black', mobileTargetId: null,            title: 'Цвет чернил',  text: 'Выбирай чёрный, синий или красный — как в настоящей тетради.' },
  { targetId: 'zoom-fit',    mobileTargetId: 'm-zoom-fit',    title: 'Масштаб',        text: 'Увеличивай колёсиком мыши или щипком. Кнопка «По экрану» всегда вернёт общий вид.' },
  { targetId: 'save-btn',    mobileTargetId: 'm-save',        title: 'Сохранение',    text: 'Сохраняй в один из 5 слотов. Автосохранение каждые 30 секунд.' },
];

function _showTutorial(overlay, onDone) {
  overlay.classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  const tutEl = _el('div', 'tutorial-overlay');
  document.body.appendChild(tutEl);
  const spotlight = _el('div', 'tutorial-spotlight');
  tutEl.appendChild(spotlight);

  let step = 0;

  function showStep(i) {
    if (i >= TUTORIAL_STEPS.length) { cleanup(); return; }
    const s = TUTORIAL_STEPS[i];
    const isMobile = window.innerWidth <= 1024;
    const targetId = (isMobile && s.mobileTargetId) ? s.mobileTargetId : s.targetId;
    const targetEl = document.getElementById(targetId) || document.getElementById(s.targetId);

    tutEl.querySelector('.tutorial-tooltip')?.remove();

    if (targetEl) {
      const r = targetEl.getBoundingClientRect(), pad = 6;
      Object.assign(spotlight.style, {
        left: (r.left - pad) + 'px', top: (r.top - pad) + 'px',
        width: (r.width + pad*2) + 'px', height: (r.height + pad*2) + 'px',
      });
    } else {
      Object.assign(spotlight.style, { left: '-9999px', top: '-9999px', width: '0', height: '0' });
    }

    const tooltip = _el('div', 'tutorial-tooltip');
    const stepLbl = _el('div', 'tutorial-step'); stepLbl.textContent = `Шаг ${i+1} из ${TUTORIAL_STEPS.length}`;
    tooltip.appendChild(stepLbl);
    const h3 = document.createElement('h3'); h3.textContent = s.title; tooltip.appendChild(h3);
    const p = document.createElement('p'); p.textContent = s.text; tooltip.appendChild(p);
    const btns = _el('div', 'tutorial-tooltip-actions');
    const skipBtn = _el('button', 'btn btn-secondary'); skipBtn.style.cssText = 'font-size:12px;padding:5px 12px'; skipBtn.textContent = 'Пропустить';
    const nextBtn = _el('button', 'btn btn-primary'); nextBtn.style.cssText = 'font-size:12px;padding:5px 12px';
    nextBtn.textContent = i < TUTORIAL_STEPS.length - 1 ? 'Далее →' : 'Начать рисовать!';
    btns.appendChild(skipBtn); btns.appendChild(nextBtn); tooltip.appendChild(btns);
    tutEl.appendChild(tooltip);
    _positionTooltip(tooltip, targetEl);
    nextBtn.addEventListener('click', () => showStep(++step));
    skipBtn.addEventListener('click', cleanup);
  }

  function cleanup() { tutEl.remove(); onDone(); }
  showStep(0);
}

function _positionTooltip(tooltip, targetEl) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const tw = 270, th = 160;
  let left, top;
  if (targetEl) {
    const r = targetEl.getBoundingClientRect();
    left = r.right + 14; top = r.top + r.height/2 - th/2;
    if (left + tw > vw - 12) { left = r.left + r.width/2 - tw/2; top = r.bottom + 14; }
    if (top + th > vh - 12) top = r.top - th - 14;
  } else { left = vw/2 - tw/2; top = vh/2 - th/2; }
  tooltip.style.left = Math.max(12, Math.min(vw - tw - 12, left)) + 'px';
  tooltip.style.top  = Math.max(12, Math.min(vh - th - 12, top))  + 'px';
}

function _drawPreviewArt(canvas) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, cs = 10;
  const cols = Math.floor(w/cs), rows = Math.floor(h/cs);
  ctx.fillStyle = '#fdf8f0'; ctx.fillRect(0, 0, w, h);
  const art = ['          ', '  ##  ##  ', '  ##  ##  ', '          ', ' #      # ', '  ######  ', '          '];
  const sc = Math.floor((cols-10)/2), sr = Math.floor((rows-7)/2);
  art.forEach((line, r) => [...line].forEach((ch, c) => {
    if (ch !== ' ') { ctx.fillStyle = '#1a3a8f'; ctx.fillRect((sc+c)*cs+1, (sr+r)*cs+1, cs-2, cs-2); }
  }));
  [[1,1,'#c0392b'],[cols-2,1,'#1a3a8f'],[1,rows-2,'#1a1a2e'],[cols-2,rows-2,'#c0392b']].forEach(([c,r,col]) => {
    ctx.fillStyle = col; ctx.fillRect(c*cs+1, r*cs+1, cs-2, cs-2);
  });
  ctx.strokeStyle = '#9ac4e8'; ctx.lineWidth = 0.5; ctx.beginPath();
  for (let c = 0; c <= cols; c++) { ctx.moveTo(c*cs+0.5, 0); ctx.lineTo(c*cs+0.5, h); }
  for (let r = 0; r <= rows; r++) { ctx.moveTo(0, r*cs+0.5); ctx.lineTo(w, r*cs+0.5); }
  ctx.stroke();
}

function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}