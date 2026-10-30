/**
 * ゲーム全体の状態（お金・アップグレード・コード・シミュレーション）をまとめる。
 * UI はこのクラスだけを見ればよい。DOM には依存しない。
 */
import { BALANCE, DEFAULT_CODE, type FeatureId, type LevelUpgradeId } from '../data/balance';
import { addEventStubs } from './api';
import { SAVE_VERSION, type SaveData } from './save';
import { ScriptHost, type ScriptErrorInfo } from './script';
import { Simulation } from './simulation';
import { deriveStats, featureDef, initialLevels, levelUpgradeCost, type UpgradeLevels } from './upgrades';

export type PurchaseId = LevelUpgradeId | FeatureId;

export interface GameOptions {
  seed?: number;
  save?: SaveData | null;
}

export class Game {
  money = 0;
  totalEarned = 0;
  readonly levels: UpgradeLevels;
  readonly features: Set<FeatureId>;
  readonly sim: Simulation;
  readonly script: ScriptHost;
  appliedCode: string;
  draftCode: string;
  /** 最後に「適用」したときのエラー */
  compileErrors: ScriptErrorInfo[] = [];
  /** セーブから引き継いだ累計（このセッションの分はシミュレーションが数える） */
  private readonly baseDelivered: number;
  private readonly baseGaveUp: number;
  private accumulator = 0;

  constructor(options: GameOptions = {}) {
    const save = options.save ?? null;
    this.levels = save ? { ...save.levels } : initialLevels();
    for (const def of BALANCE.levelUpgrades) {
      this.levels[def.id] = Math.min(this.levels[def.id], def.maxLevel);
    }
    this.features = new Set(save?.features ?? []);
    this.money = save?.money ?? 0;
    this.totalEarned = save?.totalEarned ?? 0;
    this.baseDelivered = save?.delivered ?? 0;
    this.baseGaveUp = save?.gaveUp ?? 0;

    const stats = deriveStats(this.levels);
    this.sim = new Simulation(
      { floors: stats.floors, speed: stats.speed, capacity: stats.capacity },
      stats.elevators,
      options.seed,
    );
    this.sim.events.onDeliver = (_p, reward) => {
      this.money += reward;
      this.totalEarned += reward;
    };
    this.script = new ScriptHost(this.sim, this.features);

    this.appliedCode = save?.appliedCode || DEFAULT_CODE;
    this.draftCode = save?.draftCode || this.appliedCode;
    // セーブされたコードが（仕様変更などで）動かないときは初期コードに戻す
    if (this.script.apply(this.appliedCode).length > 0) {
      this.appliedCode = DEFAULT_CODE;
      this.script.apply(DEFAULT_CODE);
    }
  }

  get delivered(): number {
    return this.baseDelivered + this.sim.stats.delivered;
  }

  get gaveUp(): number {
    return this.baseGaveUp + this.sim.stats.gaveUp;
  }

  /** 経過時間を受け取り、固定刻みでシミュレーションを進める */
  advance(seconds: number): void {
    const dt = BALANCE.tickSeconds;
    this.accumulator += seconds;
    while (this.accumulator >= dt) {
      this.sim.tick(dt);
      this.accumulator -= dt;
    }
  }

  /** エディタのコードを適用する。成功すれば空配列 */
  applyCode(code: string): ScriptErrorInfo[] {
    this.draftCode = code;
    const errors = this.script.apply(code);
    this.compileErrors = errors;
    if (errors.length === 0) this.appliedCode = code;
    return errors;
  }

  /** 購入価格。買えない（最大・解放済み）なら null */
  cost(id: PurchaseId): number | null {
    if (id in this.levels) return levelUpgradeCost(id as LevelUpgradeId, this.levels[id as LevelUpgradeId]);
    return this.features.has(id as FeatureId) ? null : featureDef(id as FeatureId).cost;
  }

  canBuy(id: PurchaseId): boolean {
    const c = this.cost(id);
    return c !== null && this.money >= c;
  }

  buy(id: PurchaseId): boolean {
    const c = this.cost(id);
    if (c === null || this.money < c) return false;
    this.money -= c;
    if (id in this.levels) {
      const lid = id as LevelUpgradeId;
      this.levels[lid]++;
      this.applyStats();
    } else {
      this.features.add(id as FeatureId);
      // 新しく使えるようになったイベント関数のひな形を、書きかけのコードに足す
      this.draftCode = addEventStubs(this.draftCode, id as FeatureId);
    }
    this.script.refreshBuiltins();
    return true;
  }

  private applyStats(): void {
    const s = deriveStats(this.levels);
    this.sim.setFloors(s.floors);
    this.sim.config.speed = s.speed;
    this.sim.config.capacity = s.capacity;
    while (this.sim.elevators.length < s.elevators) this.sim.addElevator();
  }

  toSave(): SaveData {
    return {
      version: SAVE_VERSION,
      money: this.money,
      totalEarned: this.totalEarned,
      delivered: this.delivered,
      gaveUp: this.gaveUp,
      levels: { ...this.levels },
      features: [...this.features],
      appliedCode: this.appliedCode,
      draftCode: this.draftCode,
    };
  }
}
