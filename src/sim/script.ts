/**
 * プレイヤーのコードをシミュレーションにつなぐ。
 * 使える構文・API は解放済みの機能（FeatureId）によって変わる。
 */
import { BALANCE, type FeatureId } from '../data/balance';
import { ScriptError } from './lang/lexer';
import { parse } from './lang/parser';
import {
  Interpreter,
  expectArgs,
  rangeBuiltin,
  standardBuiltins,
  type BuiltinValue,
  type HostObject,
  type Value,
} from './lang/interpreter';
import { featureDef } from './upgrades';
import { Simulation, type Elevator } from './simulation';

export interface ScriptErrorInfo {
  line: number;
  message: string;
  /** どのイベントの実行中に起きたか（コンパイル時は null） */
  event: string | null;
}

/** イベント名と、必要な機能 */
export const EVENTS: Record<string, FeatureId | null> = {
  on_idle: null,
  on_arrive: null,
  on_call: 'calls',
  on_button: 'buttons',
};

function lockedMessage(what: string, feature: FeatureId): string {
  return `${what} はまだ使えません（ショップで「${featureDef(feature).name}」を解放してください）`;
}

function builtin(name: string, call: (args: Value[], line: number) => Value): BuiltinValue {
  return { type: 'builtin', name, call };
}

export class ScriptHost {
  private interpreter: Interpreter | null = null;
  private readonly builtins: Map<string, Value>;
  private readonly lockedNames = new Map<string, string>();
  private readonly elevatorObjects = new Map<number, HostObject>();
  logs: string[] = [];
  /** 最後に起きた実行時エラー */
  runtimeError: ScriptErrorInfo | null = null;
  runtimeErrorCount = 0;

  constructor(
    private readonly sim: Simulation,
    private readonly features: Set<FeatureId>,
  ) {
    this.builtins = standardBuiltins((text) => this.log(text));
    this.refreshBuiltins();
    this.sim.events = {
      ...this.sim.events,
      onIdle: (e) => this.dispatch('on_idle', [this.elevatorObject(e)]),
      onArrive: (e, floor) => this.dispatch('on_arrive', [this.elevatorObject(e), floor]),
      onCall: (floor, dir) => this.dispatch('on_call', [floor, dir]),
      onButton: (e, floor) => this.dispatch('on_button', [this.elevatorObject(e), floor]),
    };
  }

  log(text: string): void {
    this.logs.push(text);
    if (this.logs.length > BALANCE.script.maxLogLines) this.logs.splice(0, this.logs.length - BALANCE.script.maxLogLines);
  }

  /** 機能の解放やビルの変化を、組み込み関数・定数に反映する */
  refreshBuiltins(): void {
    const b = this.builtins;
    const locked = this.lockedNames;
    b.set('floors', this.sim.config.floors);
    b.set(
      'elevators',
      this.sim.elevators.map((e) => this.elevatorObject(e)),
    );

    const gate = (name: string, feature: FeatureId, value: Value) => {
      if (this.features.has(feature)) {
        b.set(name, value);
        locked.delete(name);
      } else {
        b.delete(name);
        locked.set(name, lockedMessage(`'${name}'`, feature));
      }
    };

    gate(
      'waiting',
      'calls',
      builtin('waiting', (args, line) => {
        expectArgs('waiting', args, 1, 1, line);
        return this.sim.waiting[this.checkFloor(args[0], line)].length;
      }),
    );
    gate(
      'calls',
      'calls',
      builtin('calls', (args, line) => {
        expectArgs('calls', args, 0, 0, line);
        const out: number[] = [];
        this.sim.waiting.forEach((w, f) => {
          if (w.length > 0 && f < this.sim.config.floors) out.push(f);
        });
        return out;
      }),
    );
    gate('range', 'loops', rangeBuiltin);
  }

  private checkFloor(v: Value, line: number): number {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new ScriptError('階は整数で指定してください', line);
    if (v < 0 || v >= this.sim.config.floors) {
      throw new ScriptError(`${v} 階はありません（0 〜 ${this.sim.config.floors - 1} 階）`, line);
    }
    return v;
  }

  private elevatorObject(e: Elevator): HostObject {
    const cached = this.elevatorObjects.get(e.id);
    if (cached) return cached;
    const need = (feature: FeatureId, name: string, line: number) => {
      if (!this.features.has(feature)) throw new ScriptError(lockedMessage(`elevator.${name}`, feature), line);
    };
    const obj: HostObject = {
      type: 'host',
      typeName: 'エレベーター',
      getAttr: (name, line) => {
        switch (name) {
          case 'id':
            return e.id;
          case 'floor':
            return Simulation.floorOf(e);
          case 'load':
            return e.riders.length;
          case 'capacity':
            return this.sim.config.capacity;
          case 'go_to':
            return builtin('go_to', (args, l) => {
              expectArgs('go_to', args, 1, 1, l);
              this.pushQueue(e, this.checkFloor(args[0], l), false, l);
              return null;
            });
          case 'pressed':
            need('buttons', name, line);
            return [...new Set(e.riders.map((p) => p.to))].sort((a, b) => a - b);
          case 'queue':
            need('queue', name, line);
            return [...e.queue];
          case 'stop':
            need('queue', name, line);
            return builtin('stop', (args, l) => {
              expectArgs('stop', args, 0, 0, l);
              e.queue = [];
              return null;
            });
          case 'go_now':
            need('queue', name, line);
            return builtin('go_now', (args, l) => {
              expectArgs('go_now', args, 1, 1, l);
              this.pushQueue(e, this.checkFloor(args[0], l), true, l);
              return null;
            });
        }
        return undefined;
      },
    };
    this.elevatorObjects.set(e.id, obj);
    return obj;
  }

  private pushQueue(e: Elevator, floor: number, front: boolean, line: number): void {
    if (e.queue.length >= 100) throw new ScriptError('行き先の予定が多すぎます（上限 100）', line);
    if (front) e.queue.unshift(floor);
    else e.queue.push(floor);
  }

  /**
   * コードを読み込んでトップレベルを実行する。
   * 失敗したときはエラーを返し、それまで動いていたコードをそのまま使い続ける。
   */
  apply(code: string): ScriptErrorInfo[] {
    let program;
    try {
      program = parse(code, { allowLoops: this.features.has('loops') });
    } catch (e) {
      return [toErrorInfo(e, null)];
    }

    const errors: ScriptErrorInfo[] = [];
    for (const stmt of program) {
      if (stmt.kind !== 'def') continue;
      const feature = EVENTS[stmt.name];
      if (feature && !this.features.has(feature)) {
        errors.push({ line: stmt.line, message: lockedMessage(`イベント ${stmt.name}`, feature), event: null });
      }
    }
    if (errors.length > 0) return errors;

    this.refreshBuiltins();
    const interpreter = new Interpreter({
      maxSteps: BALANCE.script.maxStepsPerCall,
      maxDepth: BALANCE.script.maxCallDepth,
      builtins: this.builtins,
      lockedNames: this.lockedNames,
    });
    try {
      interpreter.runProgram(program);
    } catch (e) {
      return [toErrorInfo(e, null)];
    }
    if (!Object.keys(EVENTS).some((name) => interpreter.getFunction(name))) {
      return [{ line: 1, message: 'イベント関数（on_idle など）が1つも定義されていません', event: null }];
    }

    this.interpreter = interpreter;
    this.runtimeError = null;
    this.runtimeErrorCount = 0;
    this.sim.resetQueues();
    return [];
  }

  get loaded(): boolean {
    return this.interpreter !== null;
  }

  /** イベントを呼ぶ。エラーが起きても記録するだけでゲームは続ける */
  dispatch(event: string, args: Value[]): void {
    const func = this.interpreter?.getFunction(event);
    if (!this.interpreter || !func) return;
    if (func.params.length > args.length) {
      this.recordError({ line: 1, message: `${event} の引数は最大 ${args.length} 個です`, event });
      return;
    }
    try {
      this.interpreter.callExternal(func, args);
    } catch (e) {
      this.recordError(toErrorInfo(e, event));
    }
  }

  private recordError(info: ScriptErrorInfo): void {
    this.runtimeError = info;
    this.runtimeErrorCount++;
  }
}

function toErrorInfo(e: unknown, event: string | null): ScriptErrorInfo {
  if (e instanceof ScriptError) return { line: e.line, message: e.message, event };
  // 想定外の例外（インタプリタのバグなど）もゲームを止めずに表示する
  return { line: 1, message: `内部エラー: ${e instanceof Error ? e.message : String(e)}`, event };
}
