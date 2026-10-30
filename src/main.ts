/**
 * ブラウザ版のエントリーポイント。ゲームロジック（src/sim）と DOM・描画をつなぐ。
 */
import './style.css';
import { BALANCE } from './data/balance';
import { Game } from './sim/game';
import { SAVE_KEY, loadFrom, saveTo } from './sim/save';
import type { ScriptErrorInfo } from './sim/script';
import { createEditor } from './ui/editor';
import { formatMoney } from './ui/format';
import { renderReference } from './ui/reference';
import { BuildingRenderer } from './ui/renderer';
import { Shop } from './ui/shop';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function safeLoad() {
  try {
    return loadFrom(localStorage);
  } catch {
    return null;
  }
}

const game = new Game({ save: safeLoad() });
// テストやデバッグ用に公開する
(window as unknown as { __upDown: Game }).__upDown = game;

let resetting = false;
function save(): void {
  if (resetting) return;
  try {
    saveTo(localStorage, game.toSave());
  } catch {
    // ストレージが使えない環境では保存しない
  }
}

const renderer = new BuildingRenderer($<HTMLCanvasElement>('building'));
const errorsEl = $('errors');
const consoleEl = $('console');

function showErrors(errors: ScriptErrorInfo[], kind: 'compile' | 'runtime'): void {
  errorsEl.replaceChildren(
    ...errors.map((e) => {
      const div = document.createElement('div');
      const where = e.event ? `（${e.event} の実行中）` : '';
      div.textContent = `❌ ${e.line} 行目${where}: ${e.message}`;
      return div;
    }),
  );
  errorsEl.dataset.kind = kind;
  // 実行時エラーの行番号は「適用中のコード」のものなので、エディタの内容が同じときだけ印を付ける
  if (kind === 'compile' || editor.getCode() === game.appliedCode) editor.showErrors(errors);
}

function clearErrors(message = ''): void {
  errorsEl.textContent = message;
  errorsEl.dataset.kind = message ? 'ok' : '';
  editor.showErrors([]);
}

function apply(): void {
  const errors = game.applyCode(editor.getCode());
  if (errors.length > 0) showErrors(errors, 'compile');
  else clearErrors('✅ 適用しました');
  lastRuntimeErrorCount = 0;
  save();
}

const editor = createEditor($('editor'), game.draftCode, {
  onApply: apply,
  onChange: (code) => {
    game.draftCode = code;
  },
  getFeatures: () => game.features,
});
$('apply').addEventListener('click', apply);
// エディタの外（ショップなど）にフォーカスがあっても Ctrl+Enter / Cmd+Enter で適用できるようにする
document.addEventListener('keydown', (ev) => {
  if (ev.defaultPrevented || ev.key !== 'Enter' || !(ev.ctrlKey || ev.metaKey) || ev.isComposing) return;
  ev.preventDefault();
  apply();
});

// ---- 右側パネルのタブ ----
const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
      $(t.dataset.tab!).hidden = !active;
    });
  });
});

const reference = $('reference');
renderReference(reference, game.features);
const shop = new Shop($('shop'), game, () => {
  if (editor.getCode() !== game.draftCode) editor.replaceCode(game.draftCode);
  renderReference(reference, game.features);
  updateStats();
  save();
});

// ---- 速さ・リセット ----
let speed = 1;
document.querySelectorAll<HTMLButtonElement>('button.speed').forEach((b) => {
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll('button.speed').forEach((x) => x.classList.toggle('active', x === b));
  });
  b.classList.toggle('active', b.dataset.speed === '1');
});
$('reset').addEventListener('click', () => {
  if (!confirm('セーブデータを消して最初からやり直しますか？')) return;
  resetting = true;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
});

// ---- 表示の更新 ----
const setText = (el: HTMLElement, text: string) => {
  if (el.textContent !== text) el.textContent = text;
};
const moneyEl = $('money');
const deliveredEl = $('delivered');
const gaveUpEl = $('gave-up');
const infoEl = $('building-info');

function updateStats(): void {
  setText(moneyEl, formatMoney(game.money));
  setText(deliveredEl, game.delivered.toLocaleString('ja-JP'));
  setText(gaveUpEl, game.gaveUp.toLocaleString('ja-JP'));
  const c = game.sim.config;
  setText(infoEl, `${c.floors}階 / ${game.sim.elevators.length}台 / 速度 ${c.speed.toFixed(1)} / 定員 ${c.capacity}`);
}

let lastRuntimeErrorCount = 0;
let lastLogLength = -1;
let lastLog = '';
function updateScriptOutput(): void {
  const host = game.script;
  if (host.runtimeError && host.runtimeErrorCount !== lastRuntimeErrorCount) {
    lastRuntimeErrorCount = host.runtimeErrorCount;
    showErrors([host.runtimeError], 'runtime');
  }
  const tail = host.logs[host.logs.length - 1] ?? '';
  if (host.logs.length !== lastLogLength || tail !== lastLog) {
    lastLogLength = host.logs.length;
    lastLog = tail;
    consoleEl.textContent = host.logs.join('\n');
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
}

if (game.compileErrors.length > 0) showErrors(game.compileErrors, 'compile');

// ---- メインループ ----
let last = performance.now();
let uiTimer = 0;
function frame(now: number): void {
  // タブが裏にあった後などに一度に大量に進めないよう上限を設ける
  const elapsed = Math.min((now - last) / 1000, 0.25);
  last = now;
  game.advance(elapsed * speed);
  renderer.render(game.sim);
  updateStats();
  uiTimer += elapsed;
  if (uiTimer > 0.2) {
    uiTimer = 0;
    shop.update();
    updateScriptOutput();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(save, BALANCE.save.autosaveSeconds * 1000);
window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save();
});
