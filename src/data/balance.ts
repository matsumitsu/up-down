/**
 * ゲームバランスの数値をすべてここに集める。
 * 調整するときはこのファイルだけを触ればよいようにしている。
 */

/** 解放できる機能（構文・API）の ID */
export type FeatureId = 'calls' | 'buttons' | 'loops' | 'queue';

/** レベル制アップグレードの ID */
export type LevelUpgradeId = 'floors' | 'elevators' | 'speed' | 'capacity';

export interface LevelUpgradeDef {
  id: LevelUpgradeId;
  name: string;
  description: string;
  /** 1回目の購入価格 */
  baseCost: number;
  /** 購入ごとに価格へ掛ける倍率 */
  costGrowth: number;
  /** 最大レベル（初期状態はレベル0） */
  maxLevel: number;
}

export interface FeatureUnlockDef {
  id: FeatureId;
  name: string;
  description: string;
  cost: number;
}

export const BALANCE = {
  /** シミュレーションの1ステップの秒数 */
  tickSeconds: 1 / 20,

  building: {
    /** 初期の階数（0階＝ロビーを含む） */
    initialFloors: 3,
    /** 初期のエレベーター台数 */
    initialElevators: 1,
  },

  elevator: {
    /** 初期速度（階/秒） */
    baseSpeed: 1.0,
    /** 速度アップグレード1回あたりの増分（階/秒） */
    speedPerLevel: 0.4,
    /** 初期定員 */
    baseCapacity: 4,
    /** 定員アップグレード1回あたりの増分 */
    capacityPerLevel: 2,
    /** 扉が開いている時間（秒） */
    doorSeconds: 1.0,
    /** on_tick を呼ぶ間隔（秒） */
    tickEventSeconds: 1.0,
  },

  passengers: {
    /** 来客率（人/秒）＝ base + perFloor × 階数 */
    spawnRateBase: 0.1,
    spawnRatePerFloor: 0.06,
    /** 客が待てる時間（秒）。超えると帰ってしまう */
    patienceSeconds: 40,
    /** 出発階の傾向：ロビーから上へ / 上からロビーへ（残りは上の階どうし） */
    fromLobbyRatio: 0.5,
    toLobbyRatio: 0.3,
    /** 1つの階で待てる最大人数（これ以上は来ない） */
    maxWaitingPerFloor: 30,
  },

  reward: {
    /** 1人運ぶごとの基本報酬 */
    base: 3,
    /** 移動した階数 1 あたりの追加報酬 */
    perFloor: 1,
  },

  script: {
    /** 1回のイベント処理で実行できる最大ステップ数（無限ループ対策） */
    maxStepsPerCall: 20_000,
    /** 関数呼び出しの最大深さ */
    maxCallDepth: 64,
    /** 1台のかごに入れられる行き先の予定の最大件数 */
    maxQueueLength: 100,
    /** コンソールに残すログの最大行数 */
    maxLogLines: 100,
  },

  save: {
    /** オートセーブの間隔（秒） */
    autosaveSeconds: 10,
  },

  levelUpgrades: [
    {
      id: 'floors',
      name: '階を増やす',
      description: '1階分ビルを高くする。来客が増える。',
      baseCost: 40,
      costGrowth: 1.7,
      maxLevel: 9,
    },
    {
      id: 'elevators',
      name: 'エレベーターを増やす',
      description: 'かごを1台追加する。',
      baseCost: 120,
      costGrowth: 2.5,
      maxLevel: 3,
    },
    {
      id: 'speed',
      name: '速度アップ',
      description: 'かごの移動速度が上がる。',
      baseCost: 30,
      costGrowth: 1.6,
      maxLevel: 6,
    },
    {
      id: 'capacity',
      name: '定員アップ',
      description: 'かごに乗れる人数が増える。',
      baseCost: 25,
      costGrowth: 1.5,
      maxLevel: 6,
    },
  ] as LevelUpgradeDef[],

  featureUnlocks: [
    {
      id: 'calls',
      name: '呼び出しボタン API',
      description: 'on_call(floor, direction) イベントと waiting(floor), calls() が使える。',
      cost: 50,
    },
    {
      id: 'buttons',
      name: '車内ボタン API',
      description: 'on_button(elevator, floor) イベントと elevator.pressed が使える。',
      cost: 80,
    },
    {
      id: 'loops',
      name: 'ループ構文',
      description: 'for / while / break / continue と range() が使える。',
      cost: 150,
    },
    {
      id: 'queue',
      name: 'キュー操作 API',
      description: 'elevator.queue, elevator.stop(), elevator.go_now(floor) が使える。',
      cost: 250,
    },
  ] as FeatureUnlockDef[],
};

/** 最初からエディタに入っているコード */
export const DEFAULT_CODE = `# かごが止まって、行き先の予定がなくなったら呼ばれる
def on_idle(elevator):
    # 1つ上の階へ。いちばん上まで来たらロビー(0階)へ戻る
    if elevator.floor < floors - 1:
        elevator.go_to(elevator.floor + 1)
    else:
        elevator.go_to(0)
`;
