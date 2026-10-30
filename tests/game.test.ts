import { describe, expect, it } from 'vitest';
import { BALANCE, DEFAULT_CODE } from '../src/data/balance';
import { addEventStubs } from '../src/sim/api';
import { Game } from '../src/sim/game';
import { deserialize, loadFrom, saveTo, serialize, type KeyValueStorage } from '../src/sim/save';
import { rewardFor } from '../src/sim/simulation';
import { levelUpgradeCost } from '../src/sim/upgrades';

function newGame(): Game {
  return new Game({ seed: 42 });
}

/** 客の自動発生を止めた静かなゲーム */
function quietGame(): Game {
  const g = newGame();
  g.sim.spawning = false;
  return g;
}

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe('初期コード', () => {
  it('初期コードのままで客が運ばれ、お金が増える', () => {
    const g = newGame();
    expect(g.compileErrors).toEqual([]);
    g.advance(180);
    expect(g.delivered).toBeGreaterThan(10);
    expect(g.money).toBeGreaterThan(0);
    expect(g.script.runtimeError).toBeNull();
  });

  it('同じシードなら同じ結果になる', () => {
    const a = newGame();
    const b = newGame();
    a.advance(60);
    b.advance(60);
    expect(a.delivered).toBe(b.delivered);
    expect(a.money).toBe(b.money);
  });

  it('運んだ客の報酬は距離で決まる', () => {
    const g = quietGame();
    g.sim.addPassenger(0, 2);
    g.advance(20);
    expect(g.delivered).toBe(1);
    expect(g.money).toBe(rewardFor({ from: 0, to: 2 }));
  });
});

describe('コードの適用', () => {
  it('何もしないコードでは客が運ばれず、待ちすぎた客は帰る', () => {
    const g = quietGame();
    expect(g.applyCode('def on_idle(elevator):\n    pass')).toEqual([]);
    g.sim.addPassenger(1, 0);
    g.advance(BALANCE.passengers.patienceSeconds + 2);
    expect(g.delivered).toBe(0);
    expect(g.gaveUp).toBe(1);
  });

  it('コードを書き換えるとエレベーターの動きが変わる', () => {
    const g = quietGame();
    g.applyCode('def on_idle(elevator):\n    elevator.go_to(2)');
    g.advance(5);
    expect(g.sim.elevators[0].y).toBe(2);

    g.applyCode('def on_idle(elevator):\n    elevator.go_to(0)');
    g.advance(5);
    expect(g.sim.elevators[0].y).toBe(0);
  });

  it('on_arrive には階が渡される', () => {
    const g = quietGame();
    g.applyCode('def on_idle(e):\n    e.go_to(1)\ndef on_arrive(e, f):\n    print("着", f)');
    g.advance(3);
    expect(g.script.logs).toContain('着 1');
  });

  it('構文エラーなら適用されず、前のコードが動き続ける', () => {
    const g = quietGame();
    const errors = g.applyCode('def on_idle(elevator):\n    elevator.go_to(\n');
    expect(errors.length).toBe(1);
    expect(errors[0].line).toBeGreaterThan(0);
    expect(g.appliedCode).toBe(DEFAULT_CODE);
    g.sim.addPassenger(0, 1);
    g.advance(10);
    expect(g.delivered).toBe(1);
  });

  it('実行時エラー・無限ループでもゲームは止まらない', () => {
    const g = newGame();
    // ループ構文は未解放なのでまず弾かれる
    expect(g.applyCode('def on_idle(elevator):\n    while True:\n        pass')[0].message).toContain('ループ構文');
    g.features.add('loops');
    expect(g.applyCode('def on_idle(elevator):\n    while True:\n        pass')).toEqual([]);
    g.advance(5);
    expect(g.script.runtimeError?.message).toContain('無限ループ');
    expect(g.script.runtimeError?.line).toBeGreaterThan(0);
    expect(g.sim.time).toBeGreaterThan(4.9);
  });

  it('存在しない階への移動は実行時エラー', () => {
    const g = quietGame();
    g.applyCode('def on_idle(elevator):\n    elevator.go_to(99)');
    g.advance(2);
    expect(g.script.runtimeError?.line).toBe(2);
    expect(g.script.runtimeError?.event).toBe('on_idle');
  });

  it('イベント関数がないコードはエラー', () => {
    expect(quietGame().applyCode('x = 1').length).toBe(1);
  });
});

describe('イベントの呼ばれ方', () => {
  it('on_idle は止まって予定がなくなったときに1回だけ呼ばれる', () => {
    const g = quietGame();
    g.applyCode('def on_idle(e):\n    print("idle", e.floor)');
    g.advance(10);
    expect(g.script.logs).toEqual(['idle 0']);
  });

  it('動いた後に止まると、また on_idle が呼ばれる', () => {
    const g = quietGame();
    g.applyCode('n = 0\ndef on_idle(e):\n    n += 1\n    print("idle", e.floor)\n    if n == 1:\n        e.go_to(2)');
    g.advance(10);
    expect(g.script.logs).toEqual(['idle 0', 'idle 2']);
  });

  it('コードを適用し直すと、止まっているかごの on_idle がもう一度呼ばれる', () => {
    const g = quietGame();
    g.applyCode('def on_idle(e):\n    pass');
    g.advance(3);
    g.applyCode('def on_idle(e):\n    print("新しいコード")');
    g.advance(3);
    expect(g.script.logs).toEqual(['新しいコード']);
  });

  it('on_tick は1秒ごとに、かごごとに呼ばれる', () => {
    const g = quietGame();
    g.money = 1e6;
    g.buy('elevators');
    g.applyCode('def on_tick(e):\n    print(e.id)');
    g.advance(3.01);
    expect(g.script.logs).toEqual(['0', '1', '0', '1', '0', '1']);
  });

  it('移動中に適用し直しても、今向かっている階には行く（途中で止まらない）', () => {
    const g = quietGame();
    g.money = 1e6;
    for (let i = 0; i < 3; i++) g.buy('floors');
    g.applyCode('def on_idle(e):\n    if e.floor == 0:\n        e.go_to(5)\n        e.go_to(1)');
    g.advance(1.5);
    expect(g.sim.elevators[0].state).toBe('moving');
    g.applyCode('def on_idle(e):\n    print("idle", e.floor)');
    g.advance(10);
    // 5 階には着くが、古いコードの残りの予定（1 階）は消えている
    expect(g.script.logs).toEqual(['idle 5']);
  });

  it('go_to で同じ階を続けて入れても予定は溜まらない', () => {
    const g = quietGame();
    g.applyCode('def on_tick(e):\n    e.go_to(2)\n    e.go_to(2)\n    print(len(e.queue))');
    g.money = 1e6;
    g.buy('queue');
    g.advance(1.01);
    expect(g.script.logs).toEqual(['1']);
  });

  it('予定が上限を超えるとわかりやすいエラーになる', () => {
    const g = quietGame();
    g.money = 1e6;
    g.buy('loops');
    g.applyCode('def on_tick(e):\n    for i in range(60):\n        e.go_to(1)\n        e.go_to(2)');
    g.advance(1.01);
    expect(g.script.runtimeError?.message).toContain('go_to は呼ぶたびに予定の最後へ');
    expect(g.script.runtimeError?.line).toBe(3);
  });

  it('on_tick で止まっているかごを動かせる', () => {
    const g = quietGame();
    g.applyCode('def on_tick(e):\n    if e.floor == 0:\n        e.go_to(1)');
    g.advance(4);
    expect(g.sim.elevators[0].y).toBe(1);
  });
});

describe('イベント関数のひな形', () => {
  it('API を解放すると、そのイベント関数が pass だけで追加される', () => {
    const g = quietGame();
    g.money = 1e6;
    g.draftCode = 'def on_idle(e):\n    pass\n';
    g.buy('calls');
    expect(g.draftCode).toBe('def on_idle(e):\n    pass\n\ndef on_call(floor, direction):\n    pass\n');
    g.buy('buttons');
    expect(g.draftCode).toContain('\n\ndef on_button(elevator, floor):\n    pass\n');
    // ひな形を足したコードはそのまま適用できる
    expect(g.applyCode(g.draftCode)).toEqual([]);
  });

  it('すでに定義されていれば追加しない・関数を持たない機能では何もしない', () => {
    expect(addEventStubs('def on_call(a, b):\n    pass', 'calls')).toBe('def on_call(a, b):\n    pass');
    expect(addEventStubs('x = 1', 'loops')).toBe('x = 1');
  });
});

describe('機能の解放', () => {
  it('未解放のイベントや API はエラーになり、解放すると使える', () => {
    const g = quietGame();
    const code = 'def on_call(floor, direction):\n    elevators[0].go_to(floor)';
    const errors = g.applyCode(code);
    expect(errors[0].message).toContain('呼び出しボタン');

    g.money = 1000;
    expect(g.buy('calls')).toBe(true);
    expect(g.applyCode(code)).toEqual([]);
    g.sim.addPassenger(2, 0);
    g.advance(4);
    expect(g.sim.elevators[0].y).toBe(2);
  });

  it('未解放の属性は実行時エラー', () => {
    const g = quietGame();
    g.applyCode('def on_idle(elevator):\n    print(elevator.pressed)');
    g.advance(2);
    expect(g.script.runtimeError?.message).toContain('車内ボタン');
  });

  it('on_button と elevator.pressed', () => {
    const g = quietGame();
    g.money = 1000;
    g.buy('buttons');
    g.applyCode('def on_idle(e):\n    pass\ndef on_button(e, floor):\n    e.go_to(floor)\n    print(e.pressed)');
    g.sim.addPassenger(0, 2);
    g.advance(6);
    expect(g.script.logs).toContain('[2]');
    expect(g.delivered).toBe(1);
  });

  it('キュー操作 API', () => {
    const g = quietGame();
    g.money = 10_000;
    g.buy('queue');
    g.buy('loops');
    g.applyCode('def on_idle(e):\n    for f in [2, 1]:\n        e.go_to(f)\n    e.go_now(1)\n    print(e.queue)\n    e.stop()');
    g.advance(1.5);
    expect(g.script.logs[0]).toBe('[1, 2, 1]');
    expect(g.sim.elevators[0].queue).toEqual([]);
  });
});

describe('アップグレード', () => {
  it('お金が足りなければ買えない', () => {
    const g = quietGame();
    expect(g.buy('floors')).toBe(false);
  });

  it('階・エレベーター・速度・定員が変わる', () => {
    const g = quietGame();
    g.money = 100_000;
    const before = g.money;
    expect(g.buy('floors')).toBe(true);
    expect(g.money).toBe(before - levelUpgradeCost('floors', 0)!);
    expect(g.sim.config.floors).toBe(BALANCE.building.initialFloors + 1);
    expect(g.sim.waiting.length).toBe(g.sim.config.floors);

    g.buy('elevators');
    expect(g.sim.elevators.length).toBe(2);
    g.buy('speed');
    expect(g.sim.config.speed).toBeCloseTo(BALANCE.elevator.baseSpeed + BALANCE.elevator.speedPerLevel);
    g.buy('capacity');
    expect(g.sim.config.capacity).toBe(BALANCE.elevator.baseCapacity + BALANCE.elevator.capacityPerLevel);
  });

  it('階を増やすと floors の値も変わる', () => {
    const g = quietGame();
    g.money = 100_000;
    g.applyCode('def on_tick(e):\n    print(floors)');
    g.advance(1.1);
    g.buy('floors');
    g.advance(1.1);
    expect(g.script.logs.slice(-1)[0]).toBe(String(BALANCE.building.initialFloors + 1));
  });

  it('最大レベルを超えては買えない', () => {
    const g = quietGame();
    g.money = 1e12;
    const max = BALANCE.levelUpgrades.find((u) => u.id === 'elevators')!.maxLevel;
    for (let i = 0; i < max; i++) expect(g.buy('elevators')).toBe(true);
    expect(g.buy('elevators')).toBe(false);
    expect(g.cost('elevators')).toBeNull();
  });

  it('解放済みの機能は二度買えない', () => {
    const g = quietGame();
    g.money = 1e6;
    expect(g.buy('loops')).toBe(true);
    expect(g.buy('loops')).toBe(false);
  });
});

describe('セーブ', () => {
  it('保存して読み込むと状態が戻る', () => {
    const g = newGame();
    g.money = 5000;
    g.buy('floors');
    g.buy('calls');
    g.applyCode('def on_idle(e):\n    e.go_to(1)');
    g.draftCode = '# 書きかけ';
    g.advance(30);

    const storage = memoryStorage();
    saveTo(storage, g.toSave());
    const loaded = new Game({ seed: 1, save: loadFrom(storage) });
    expect(loaded.money).toBe(g.money);
    expect(loaded.levels.floors).toBe(1);
    expect(loaded.features.has('calls')).toBe(true);
    expect(loaded.appliedCode).toBe('def on_idle(e):\n    e.go_to(1)');
    expect(loaded.draftCode).toBe('# 書きかけ');
    expect(loaded.delivered).toBe(g.delivered);
    expect(loaded.sim.config.floors).toBe(g.sim.config.floors);
  });

  it('壊れたデータは null', () => {
    expect(deserialize('{壊れた')).toBeNull();
    expect(deserialize(null)).toBeNull();
    expect(deserialize(JSON.stringify({ version: 999 }))).toBeNull();
  });

  it('不正な値は安全な値に直す', () => {
    const d = deserialize(serialize({ ...newGame().toSave(), money: -5, features: ['calls', 'hack' as never] }));
    expect(d?.money).toBe(0);
    expect(d?.features).toEqual(['calls']);
  });
});

describe('バランスデータ', () => {
  it('価格は正でレベルとともに上がる', () => {
    for (const u of BALANCE.levelUpgrades) {
      expect(u.baseCost).toBeGreaterThan(0);
      expect(levelUpgradeCost(u.id, 1)!).toBeGreaterThanOrEqual(levelUpgradeCost(u.id, 0)!);
    }
  });

  it('初期コードは構文エラーにならない', () => {
    expect(quietGame().applyCode(DEFAULT_CODE)).toEqual([]);
  });
});

describe('README の例', () => {
  it('呼び出し・車内ボタンを使う例が動き、初期コードより多く運べる', () => {
    const code = [
      'def on_call(floor, direction):',
      '    elevators[floor % len(elevators)].go_to(floor)',
      '',
      'def on_button(elevator, floor):',
      '    elevator.go_to(floor)',
      '',
      'def on_idle(elevator):',
      '    if elevator.floor != 0:',
      '        elevator.go_to(0)',
    ].join('\n');
    const g = newGame();
    g.money = 1e6;
    g.buy('calls');
    g.buy('buttons');
    expect(g.applyCode(code)).toEqual([]);
    g.advance(300);
    expect(g.script.runtimeError).toBeNull();
    expect(g.delivered).toBeGreaterThan(50);
  });
});
