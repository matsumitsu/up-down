/**
 * ビルの断面図を Canvas 2D で描く。シミュレーションの状態を読むだけで書き換えない。
 */
import { BALANCE } from '../data/balance';
import { Simulation } from '../sim/simulation';

const COLORS = {
  bg: '#14171f',
  floorLine: '#2c3240',
  floorLabel: '#7d8597',
  shaft: '#1c2029',
  car: '#4f8cff',
  carDoors: '#46c37b',
  carIdle: '#5a6478',
  text: '#ffffff',
  queueMark: '#ffcc4d',
};

export class BuildingRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D が使えません');
    this.ctx = ctx;
  }

  /** 表示サイズに合わせてキャンバスの解像度を調整する */
  private resize(): { w: number; h: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, Math.floor(rect.width));
    const h = Math.max(200, Math.floor(rect.height));
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  render(sim: Simulation): void {
    const { w, h } = this.resize();
    const ctx = this.ctx;
    const floors = sim.config.floors;
    const top = 10;
    const floorH = (h - top - 10) / floors;
    const labelW = 36;
    const shaftW = Math.min(70, Math.max(40, (w - labelW) * 0.12));
    const shaftGap = 8;
    const shaftsX = labelW;
    const waitX = shaftsX + sim.elevators.length * (shaftW + shaftGap) + 12;

    // 階 f の床の y 座標（0 階がいちばん下）
    const floorY = (f: number) => top + (floors - f) * floorH;

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // 床と階番号
    ctx.font = `${Math.min(14, floorH * 0.4)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    for (let f = 0; f < floors; f++) {
      const y = floorY(f);
      ctx.strokeStyle = COLORS.floorLine;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.floorLabel;
      ctx.textAlign = 'left';
      ctx.fillText(`${f}F`, 4, y - floorH / 2);
    }

    // シャフトとかご
    sim.elevators.forEach((e, i) => {
      const x = shaftsX + i * (shaftW + shaftGap);
      ctx.fillStyle = COLORS.shaft;
      ctx.fillRect(x, top, shaftW, floors * floorH);

      // 行き先の予定を小さな印で示す
      ctx.fillStyle = COLORS.queueMark;
      for (const q of e.queue) {
        ctx.fillRect(x + shaftW - 6, floorY(q) - floorH / 2 - 3, 6, 6);
      }

      const carH = floorH * 0.8;
      const cy = floorY(e.y) - carH - floorH * 0.05;
      ctx.fillStyle = e.state === 'doors' ? COLORS.carDoors : e.state === 'idle' ? COLORS.carIdle : COLORS.car;
      ctx.fillRect(x + 3, cy, shaftW - 6, carH);

      // 乗っている客を点で表す
      const cap = sim.config.capacity;
      const cols = Math.ceil(Math.sqrt(cap * 1.5));
      const dot = Math.min((shaftW - 12) / cols, carH / Math.ceil(cap / cols)) * 0.7;
      e.riders.forEach((p, k) => {
        const cx = x + 6 + (k % cols) * (dot / 0.7) + dot / 2;
        const ry = cy + 4 + Math.floor(k / cols) * (dot / 0.7) + dot / 2;
        ctx.fillStyle = p.to > Simulation.floorOf(e) ? '#ffffff' : '#ffd7a8';
        ctx.beginPath();
        ctx.arc(cx, ry, dot / 2, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.min(12, carH * 0.35)}px system-ui, sans-serif`;
      ctx.fillText(`${e.riders.length}/${cap}`, x + shaftW / 2, cy + carH - Math.min(8, carH * 0.2));
    });

    // 待っている客（色は残りの忍耐、数字は行き先）
    const patience = BALANCE.passengers.patienceSeconds;
    const r = Math.max(4, Math.min(9, floorH * 0.22));
    const step = r * 2 + 4;
    const maxShown = Math.max(1, Math.floor((w - waitX - 40) / step));
    ctx.font = `${Math.round(r * 1.1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    for (let f = 0; f < floors; f++) {
      const list = sim.waiting[f] ?? [];
      const cy = floorY(f) - r - 3;
      list.slice(0, maxShown).forEach((p, k) => {
        const t = Math.min(1, p.waited / patience);
        ctx.fillStyle = `hsl(${120 - 120 * t}, 70%, 55%)`;
        const cx = waitX + k * step + r;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#10131a';
        ctx.fillText(String(p.to), cx, cy + 1);
      });
      if (list.length > maxShown) {
        ctx.fillStyle = COLORS.text;
        ctx.textAlign = 'left';
        ctx.fillText(`+${list.length - maxShown}`, waitX + maxShown * step, cy);
        ctx.textAlign = 'center';
      }
    }
  }
}
