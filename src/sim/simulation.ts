/**
 * ビル・エレベーター・客の物理シミュレーション。
 * DOM や描画には一切依存しないので Node.js 上でそのままテストできる。
 * プレイヤーのコードとのつなぎ込みは SimEvents（コールバック）経由で行う。
 */
import { BALANCE } from '../data/balance';
import { Rng } from './rng';

export interface Passenger {
  id: number;
  from: number;
  to: number;
  /** 待っている時間（秒） */
  waited: number;
}

export type ElevatorState = 'idle' | 'moving' | 'doors';

export interface Elevator {
  id: number;
  /** 位置（階単位。0 = ロビー） */
  y: number;
  state: ElevatorState;
  /** 行き先の予定（先頭から順に向かう） */
  queue: number[];
  riders: Passenger[];
  doorTimer: number;
  /** 今回の停止で on_idle をすでに呼んだか */
  idleNotified: boolean;
  /** 最後に動いた向き（+1 上 / -1 下 / 0） */
  lastDir: number;
}

export interface SimConfig {
  floors: number;
  speed: number;
  capacity: number;
}

/** シミュレーションで起きた出来事の通知先 */
export interface SimEvents {
  onIdle?(elevator: Elevator): void;
  onTick?(elevator: Elevator): void;
  onArrive?(elevator: Elevator, floor: number): void;
  onCall?(floor: number, direction: 'up' | 'down'): void;
  onButton?(elevator: Elevator, floor: number): void;
  onDeliver?(passenger: Passenger, reward: number): void;
  onGiveUp?(passenger: Passenger): void;
}

export interface SimStats {
  delivered: number;
  gaveUp: number;
  spawned: number;
}

export function rewardFor(p: Pick<Passenger, 'from' | 'to'>): number {
  return BALANCE.reward.base + BALANCE.reward.perFloor * Math.abs(p.to - p.from);
}

export function spawnRate(floors: number): number {
  return BALANCE.passengers.spawnRateBase + BALANCE.passengers.spawnRatePerFloor * floors;
}

export class Simulation {
  time = 0;
  readonly elevators: Elevator[] = [];
  /** 各階で待っている客（先に来た順） */
  waiting: Passenger[][] = [];
  readonly stats: SimStats = { delivered: 0, gaveUp: 0, spawned: 0 };
  events: SimEvents = {};
  /** 客の自動発生を止める（テスト用） */
  spawning = true;

  private nextPassengerId = 1;
  private tickEventTimer = 0;
  private readonly rng: Rng;

  constructor(
    public readonly config: SimConfig,
    elevatorCount: number,
    seed = Date.now(),
  ) {
    this.rng = new Rng(seed);
    this.waiting = Array.from({ length: config.floors }, () => []);
    for (let i = 0; i < elevatorCount; i++) this.addElevator();
  }

  addElevator(): Elevator {
    const e: Elevator = {
      id: this.elevators.length,
      y: 0,
      state: 'idle',
      queue: [],
      riders: [],
      doorTimer: 0,
      // 最初の tick ですぐ on_idle が呼ばれるようにする
      idleNotified: false,
      lastDir: 0,
    };
    this.elevators.push(e);
    return e;
  }

  setFloors(floors: number): void {
    this.config.floors = floors;
    while (this.waiting.length < floors) this.waiting.push([]);
  }

  /** 現在いる（いちばん近い）階 */
  static floorOf(e: Elevator): number {
    return Math.round(e.y);
  }

  /** 客を1人発生させる（テストからも呼べる） */
  addPassenger(from: number, to: number): Passenger {
    const p: Passenger = { id: this.nextPassengerId++, from, to, waited: 0 };
    this.waiting[from].push(p);
    this.stats.spawned++;
    this.events.onCall?.(from, to > from ? 'up' : 'down');
    return p;
  }

  /**
   * コードを適用し直したときに、古いコードが入れた予定を消す。
   * 移動中のかごは、今向かっている階だけは残す（途中の階で急に止まって巡回が崩れないように）。
   */
  resetQueues(): void {
    for (const e of this.elevators) {
      e.queue = e.state === 'moving' && e.queue.length > 0 ? [e.queue[0]] : [];
      // 止まっているかごには、新しいコードの on_idle をもう一度呼ぶ
      if (e.state === 'idle') e.idleNotified = false;
    }
  }

  tick(dt: number): void {
    this.time += dt;
    if (this.spawning) this.spawn(dt);
    this.updatePatience(dt);
    for (const e of this.elevators) this.updateElevator(e, dt);
    this.tickEventTimer += dt;
    if (this.tickEventTimer >= BALANCE.elevator.tickEventSeconds - 1e-9) {
      this.tickEventTimer = 0;
      for (const e of this.elevators) this.events.onTick?.(e);
    }
  }

  private spawn(dt: number): void {
    const n = this.config.floors;
    if (n < 2) return;
    if (this.rng.next() >= spawnRate(n) * dt) return;

    const { fromLobbyRatio, toLobbyRatio, maxWaitingPerFloor } = BALANCE.passengers;
    const r = this.rng.next();
    let from: number;
    let to: number;
    if (r < fromLobbyRatio || n < 3) {
      from = 0;
      to = this.rng.int(1, n - 1);
    } else if (r < fromLobbyRatio + toLobbyRatio) {
      from = this.rng.int(1, n - 1);
      to = 0;
    } else {
      from = this.rng.int(1, n - 1);
      to = this.rng.int(1, n - 2);
      if (to >= from) to++;
    }
    if (this.waiting[from].length >= maxWaitingPerFloor) return;
    this.addPassenger(from, to);
  }

  private updatePatience(dt: number): void {
    const limit = BALANCE.passengers.patienceSeconds;
    for (let f = 0; f < this.waiting.length; f++) {
      const stay: Passenger[] = [];
      for (const p of this.waiting[f]) {
        p.waited += dt;
        if (p.waited > limit) {
          this.stats.gaveUp++;
          this.events.onGiveUp?.(p);
        } else {
          stay.push(p);
        }
      }
      this.waiting[f] = stay;
    }
  }

  private updateElevator(e: Elevator, dt: number): void {
    switch (e.state) {
      case 'idle':
        this.exchange(e);
        if (e.queue.length > 0) {
          this.departOrArrive(e);
        } else if (!e.idleNotified) {
          e.idleNotified = true;
          this.events.onIdle?.(e);
          // on_idle の中で予定が入ったら、同じ tick のうちに出発する
          if (e.queue.length > 0) this.departOrArrive(e);
        }
        return;
      case 'doors':
        this.exchange(e);
        e.doorTimer -= dt;
        if (e.doorTimer <= 0) {
          if (e.queue.length > 0) {
            this.departOrArrive(e);
          } else {
            e.state = 'idle';
            e.idleNotified = true;
            this.events.onIdle?.(e);
          }
        }
        return;
      case 'moving':
        this.move(e, dt);
        return;
    }
  }

  private departOrArrive(e: Elevator): void {
    if (e.queue[0] === Simulation.floorOf(e) && Math.abs(e.y - e.queue[0]) < 1e-9) {
      this.arrive(e, e.queue.shift()!);
    } else {
      e.state = 'moving';
    }
  }

  private move(e: Elevator, dt: number): void {
    if (e.queue.length === 0) {
      // 予定が消されたら、進行方向の次の階で止まる
      const next = e.lastDir >= 0 ? Math.ceil(e.y - 1e-9) : Math.floor(e.y + 1e-9);
      e.queue.push(Math.max(0, Math.min(this.config.floors - 1, next)));
    }
    const target = e.queue[0];
    const diff = target - e.y;
    const step = this.config.speed * dt;
    if (Math.abs(diff) <= step) {
      e.y = target;
      e.queue.shift();
      this.arrive(e, target);
    } else {
      e.lastDir = Math.sign(diff);
      e.y += e.lastDir * step;
    }
  }

  private arrive(e: Elevator, floor: number): void {
    e.state = 'doors';
    e.doorTimer = BALANCE.elevator.doorSeconds;
    this.exchange(e);
    this.events.onArrive?.(e, floor);
  }

  /** 止まっているかごで、降りる客を降ろし、待っている客を乗せる */
  private exchange(e: Elevator): void {
    const floor = Simulation.floorOf(e);
    if (Math.abs(e.y - floor) > 1e-9) return;

    const stay: Passenger[] = [];
    for (const p of e.riders) {
      if (p.to === floor) {
        this.stats.delivered++;
        this.events.onDeliver?.(p, rewardFor(p));
      } else {
        stay.push(p);
      }
    }
    e.riders = stay;

    const queue = this.waiting[floor];
    if (!queue) return;
    const boarded: Passenger[] = [];
    while (queue.length > 0 && e.riders.length < this.config.capacity) {
      const p = queue.shift()!;
      e.riders.push(p);
      boarded.push(p);
    }
    for (const p of boarded) this.events.onButton?.(e, p.to);
  }
}
