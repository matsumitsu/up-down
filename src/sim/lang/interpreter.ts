/**
 * Python 風言語のインタプリタ（木を直接たどって実行する）。
 * eval / new Function は使わない。ステップ数と呼び出しの深さに上限を設け、
 * 無限ループや無限再帰があってもゲーム本体が止まらないようにしている。
 */
import { ScriptError } from './lexer';
import type { Expr, Stmt, Target } from './parser';

export interface FuncValue {
  type: 'func';
  name: string;
  params: string[];
  body: Stmt[];
}

export interface BuiltinValue {
  type: 'builtin';
  name: string;
  call: (args: Value[], line: number) => Value;
}

/** ゲーム側のオブジェクト（エレベーターなど）を言語から見せるための窓口 */
export interface HostObject {
  type: 'host';
  typeName: string;
  /** 属性を返す。存在しなければ undefined。使えない属性は ScriptError を投げてよい */
  getAttr: (name: string, line: number) => Value | undefined;
}

export type Value = number | string | boolean | null | Value[] | FuncValue | BuiltinValue | HostObject;

export interface InterpreterOptions {
  maxSteps: number;
  maxDepth: number;
  /** 組み込み関数・定数（ホストが用意する） */
  builtins: Map<string, Value>;
  /** まだ解放されていない名前 → エラーメッセージ */
  lockedNames?: Map<string, string>;
}

class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(public readonly value: Value) {}
}

type Scope = Map<string, Value> | null;

export class Interpreter {
  readonly globals = new Map<string, Value>();
  private steps = 0;
  private depth = 0;

  constructor(private readonly options: InterpreterOptions) {}

  /** トップレベルのコードを実行する */
  runProgram(program: Stmt[]): void {
    this.steps = 0;
    this.depth = 0;
    this.execBlock(program, null);
  }

  /** 定義されたユーザー関数を返す（なければ null） */
  getFunction(name: string): FuncValue | null {
    const v = this.globals.get(name);
    return v !== undefined && isFunc(v) ? v : null;
  }

  /** 外部（ゲーム）からユーザー関数を呼ぶ。引数は関数が受け取る数だけ渡す */
  callExternal(func: FuncValue, args: Value[]): Value {
    this.steps = 0;
    this.depth = 0;
    return this.callUser(func, args.slice(0, func.params.length), 0);
  }

  // ---- 文 ----

  private step(line: number): void {
    if (++this.steps > this.options.maxSteps) {
      throw new ScriptError(`処理が長すぎるため中断しました（無限ループかもしれません。上限 ${this.options.maxSteps} ステップ）`, line);
    }
  }

  private execBlock(body: Stmt[], scope: Scope): void {
    for (const stmt of body) this.exec(stmt, scope);
  }

  private exec(stmt: Stmt, scope: Scope): void {
    this.step(stmt.line);
    switch (stmt.kind) {
      case 'expr':
        this.eval(stmt.expr, scope);
        return;
      case 'assign':
        this.execAssign(stmt.target, stmt.op, stmt.value, scope, stmt.line);
        return;
      case 'if':
        if (truthy(this.eval(stmt.cond, scope))) this.execBlock(stmt.body, scope);
        else this.execBlock(stmt.orelse, scope);
        return;
      case 'while':
        while (truthy(this.eval(stmt.cond, scope))) {
          this.step(stmt.line);
          try {
            this.execBlock(stmt.body, scope);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      case 'for': {
        const iter = this.eval(stmt.iter, scope);
        let items: Value[];
        if (Array.isArray(iter)) items = [...iter];
        else if (typeof iter === 'string') items = [...iter];
        else throw new ScriptError(`${typeName(iter)} は for で回せません`, stmt.line);
        for (const item of items) {
          this.step(stmt.line);
          this.setVar(stmt.name, item, scope);
          try {
            this.execBlock(stmt.body, scope);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'def':
        this.setVar(stmt.name, { type: 'func', name: stmt.name, params: stmt.params, body: stmt.body }, scope);
        return;
      case 'return':
        throw new ReturnSignal(stmt.value ? this.eval(stmt.value, scope) : null);
      case 'pass':
        return;
      case 'break':
        throw new BreakSignal();
      case 'continue':
        throw new ContinueSignal();
    }
  }

  private execAssign(target: Target, op: string, valueExpr: Expr, scope: Scope, line: number): void {
    const compute = (current: () => Value): Value => {
      const value = this.eval(valueExpr, scope);
      if (op === '=') return value;
      return binaryOp(op.slice(0, -1), current(), value, line);
    };
    switch (target.kind) {
      case 'name':
        this.setVar(target.name, compute(() => this.lookup(target.name, scope, line)), scope);
        return;
      case 'index': {
        const obj = this.eval(target.obj, scope);
        const idx = this.eval(target.index, scope);
        if (!Array.isArray(obj)) throw new ScriptError(`${typeName(obj)} の要素は書き換えられません`, line);
        const i = listIndex(obj, idx, line);
        obj[i] = compute(() => obj[i]);
        return;
      }
      case 'attr':
        throw new ScriptError(`属性 '${target.name}' は書き換えられません`, line);
    }
  }

  /**
   * 変数への代入。関数の中では、すでにグローバルにある名前ならグローバルを書き換える
   * （Python の global 宣言を省略できるようにしている）。
   */
  private setVar(name: string, value: Value, scope: Scope): void {
    if (scope && !scope.has(name) && this.globals.has(name)) {
      this.globals.set(name, value);
    } else {
      (scope ?? this.globals).set(name, value);
    }
  }

  private lookup(name: string, scope: Scope, line: number): Value {
    if (scope?.has(name)) return scope.get(name)!;
    if (this.globals.has(name)) return this.globals.get(name)!;
    if (this.options.builtins.has(name)) return this.options.builtins.get(name)!;
    const locked = this.options.lockedNames?.get(name);
    if (locked) throw new ScriptError(locked, line);
    throw new ScriptError(`'${name}' は定義されていません`, line);
  }

  // ---- 式 ----

  private eval(expr: Expr, scope: Scope): Value {
    switch (expr.kind) {
      case 'num':
      case 'str':
      case 'const':
        return expr.value;
      case 'name':
        return this.lookup(expr.name, scope, expr.line);
      case 'list':
        return expr.items.map((e) => this.eval(e, scope));
      case 'attr':
        return this.getAttr(this.eval(expr.obj, scope), expr.name, expr.line);
      case 'index': {
        const obj = this.eval(expr.obj, scope);
        const idx = this.eval(expr.index, scope);
        if (Array.isArray(obj)) return obj[listIndex(obj, idx, expr.line)];
        if (typeof obj === 'string') return obj[listIndex([...obj], idx, expr.line)];
        throw new ScriptError(`${typeName(obj)} には [ ] が使えません`, expr.line);
      }
      case 'call': {
        const func = this.eval(expr.func, scope);
        const args = expr.args.map((a) => this.eval(a, scope));
        return this.callValue(func, args, expr.line);
      }
      case 'unary': {
        const v = this.eval(expr.operand, scope);
        if (expr.op === 'not') return !truthy(v);
        const n = toNumber(v, expr.op, expr.line);
        return expr.op === '-' ? -n : n;
      }
      case 'bool': {
        const left = this.eval(expr.left, scope);
        if (expr.op === 'and') return truthy(left) ? this.eval(expr.right, scope) : left;
        return truthy(left) ? left : this.eval(expr.right, scope);
      }
      case 'binary':
        return binaryOp(expr.op, this.eval(expr.left, scope), this.eval(expr.right, scope), expr.line);
    }
  }

  private getAttr(obj: Value, name: string, line: number): Value {
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj) && obj.type === 'host') {
      const v = obj.getAttr(name, line);
      if (v === undefined) throw new ScriptError(`${obj.typeName} に '${name}' はありません`, line);
      return v;
    }
    if (Array.isArray(obj)) {
      const m = listMethod(obj, name);
      if (m) return m;
    }
    throw new ScriptError(`${typeName(obj)} に '${name}' はありません`, line);
  }

  private callValue(func: Value, args: Value[], line: number): Value {
    if (func !== null && typeof func === 'object' && !Array.isArray(func)) {
      if (func.type === 'builtin') {
        this.step(line);
        return func.call(args, line);
      }
      if (func.type === 'func') {
        if (args.length !== func.params.length) {
          throw new ScriptError(`${func.name}() の引数は ${func.params.length} 個ですが ${args.length} 個渡されました`, line);
        }
        return this.callUser(func, args, line);
      }
    }
    throw new ScriptError(`${typeName(func)} は関数として呼べません`, line);
  }

  private callUser(func: FuncValue, args: Value[], line: number): Value {
    if (this.depth >= this.options.maxDepth) {
      throw new ScriptError(`関数の呼び出しが深すぎます（上限 ${this.options.maxDepth}）`, line);
    }
    const scope = new Map<string, Value>();
    func.params.forEach((p, i) => scope.set(p, args[i] ?? null));
    this.depth++;
    try {
      this.execBlock(func.body, scope);
      return null;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    } finally {
      this.depth--;
    }
  }
}

// ---- 値の操作 ----

export function isFunc(v: Value): v is FuncValue {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && v.type === 'func';
}

export function truthy(v: Value): boolean {
  if (v === null || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function typeName(v: Value): string {
  if (v === null) return 'None';
  if (typeof v === 'number') return '数値';
  if (typeof v === 'string') return '文字列';
  if (typeof v === 'boolean') return '真偽値';
  if (Array.isArray(v)) return 'リスト';
  if (v.type === 'host') return v.typeName;
  return '関数';
}

export function formatValue(v: Value, nested = false): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'string') return nested ? `'${v}'` : v;
  if (Array.isArray(v)) return `[${v.map((x) => formatValue(x, true)).join(', ')}]`;
  if (v.type === 'host') return `<${v.typeName}>`;
  return `<関数 ${v.name}>`;
}

export function valuesEqual(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]));
  }
  if (typeof a === 'boolean' && typeof b === 'number') return Number(a) === b;
  if (typeof a === 'number' && typeof b === 'boolean') return a === Number(b);
  return a === b;
}

export function toNumber(v: Value, op: string, line: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new ScriptError(`${typeName(v)} に '${op}' は使えません`, line);
}

function listIndex(list: Value[], idx: Value, line: number): number {
  if (typeof idx !== 'number' || !Number.isInteger(idx)) {
    throw new ScriptError('添字は整数で指定してください', line);
  }
  const i = idx < 0 ? list.length + idx : idx;
  if (i < 0 || i >= list.length) throw new ScriptError(`添字 ${idx} は範囲外です（長さ ${list.length}）`, line);
  return i;
}

function binaryOp(op: string, a: Value, b: Value, line: number): Value {
  switch (op) {
    case '==':
      return valuesEqual(a, b);
    case '!=':
      return !valuesEqual(a, b);
    case 'in':
    case 'not in': {
      let found: boolean;
      if (Array.isArray(b)) found = b.some((x) => valuesEqual(x, a));
      else if (typeof b === 'string' && typeof a === 'string') found = b.includes(a);
      else throw new ScriptError(`${typeName(b)} に 'in' は使えません`, line);
      return op === 'in' ? found : !found;
    }
    case '<':
    case '>':
    case '<=':
    case '>=': {
      if (typeof a === 'string' && typeof b === 'string') return compare(op, a < b ? -1 : a > b ? 1 : 0);
      const x = toNumber(a, op, line);
      const y = toNumber(b, op, line);
      return compare(op, x - y);
    }
    case '+':
      if (typeof a === 'string' && typeof b === 'string') return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      if (typeof a === 'string' || typeof b === 'string') {
        throw new ScriptError('文字列と数値は + でつなげません。str() で変換してください', line);
      }
      return toNumber(a, op, line) + toNumber(b, op, line);
  }
  const x = toNumber(a, op, line);
  const y = toNumber(b, op, line);
  switch (op) {
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      if (y === 0) throw new ScriptError('0 で割ることはできません', line);
      return x / y;
    case '//':
      if (y === 0) throw new ScriptError('0 で割ることはできません', line);
      return Math.floor(x / y);
    case '%':
      if (y === 0) throw new ScriptError('0 で割ることはできません', line);
      return ((x % y) + y) % y;
    case '**':
      return x ** y;
  }
  throw new ScriptError(`未知の演算子 '${op}'`, line);
}

function compare(op: string, diff: number): boolean {
  switch (op) {
    case '<':
      return diff < 0;
    case '>':
      return diff > 0;
    case '<=':
      return diff <= 0;
    default:
      return diff >= 0;
  }
}

function listMethod(list: Value[], name: string): BuiltinValue | null {
  const make = (call: (args: Value[], line: number) => Value): BuiltinValue => ({ type: 'builtin', name, call });
  switch (name) {
    case 'append':
      return make((args, line) => {
        expectArgs(name, args, 1, 1, line);
        list.push(args[0]);
        return null;
      });
    case 'pop':
      return make((args, line) => {
        expectArgs(name, args, 0, 1, line);
        if (list.length === 0) throw new ScriptError('空のリストから pop() はできません', line);
        const i = args.length ? listIndex(list, args[0], line) : list.length - 1;
        return list.splice(i, 1)[0];
      });
    case 'insert':
      return make((args, line) => {
        expectArgs(name, args, 2, 2, line);
        const i = toNumber(args[0], 'insert', line);
        list.splice(Math.max(0, Math.min(list.length, i < 0 ? list.length + i : i)), 0, args[1]);
        return null;
      });
    case 'remove':
      return make((args, line) => {
        expectArgs(name, args, 1, 1, line);
        const i = list.findIndex((x) => valuesEqual(x, args[0]));
        if (i < 0) throw new ScriptError(`${formatValue(args[0], true)} はリストにありません`, line);
        list.splice(i, 1);
        return null;
      });
  }
  return null;
}

export function expectArgs(name: string, args: Value[], min: number, max: number, line: number): void {
  if (args.length < min || args.length > max) {
    const want = min === max ? `${min}` : `${min}〜${max}`;
    throw new ScriptError(`${name}() の引数は ${want} 個です（${args.length} 個渡されました）`, line);
  }
}

/** どのゲームでも使える標準の組み込み関数 */
export function standardBuiltins(print: (text: string) => void): Map<string, Value> {
  const m = new Map<string, Value>();
  const def = (name: string, call: (args: Value[], line: number) => Value) => m.set(name, { type: 'builtin', name, call });

  def('print', (args) => {
    print(args.map((a) => formatValue(a)).join(' '));
    return null;
  });
  def('len', (args, line) => {
    expectArgs('len', args, 1, 1, line);
    const v = args[0];
    if (Array.isArray(v) || typeof v === 'string') return v.length;
    throw new ScriptError(`${typeName(v)} に len() は使えません`, line);
  });
  def('abs', (args, line) => {
    expectArgs('abs', args, 1, 1, line);
    return Math.abs(toNumber(args[0], 'abs', line));
  });
  const minmax = (name: 'min' | 'max') => (args: Value[], line: number) => {
    const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (items.length === 0) throw new ScriptError(`${name}() に空のリストは渡せません`, line);
    const nums = items.map((v) => toNumber(v, name, line));
    return name === 'min' ? Math.min(...nums) : Math.max(...nums);
  };
  def('min', minmax('min'));
  def('max', minmax('max'));
  def('int', (args, line) => {
    expectArgs('int', args, 1, 1, line);
    const v = args[0];
    if (typeof v === 'string') {
      const n = Number(v.trim());
      if (!Number.isFinite(n)) throw new ScriptError(`'${v}' は数値に変換できません`, line);
      return Math.trunc(n);
    }
    return Math.trunc(toNumber(v, 'int', line));
  });
  def('round', (args, line) => {
    expectArgs('round', args, 1, 1, line);
    return Math.round(toNumber(args[0], 'round', line));
  });
  def('str', (args, line) => {
    expectArgs('str', args, 1, 1, line);
    return formatValue(args[0]);
  });
  return m;
}

/** range()（ループ構文の解放で使えるようになる） */
export const rangeBuiltin: BuiltinValue = {
  type: 'builtin',
  name: 'range',
  call: (args, line) => {
    expectArgs('range', args, 1, 3, line);
    const nums = args.map((a) => toNumber(a, 'range', line));
    const [start, stop, stepVal] = nums.length === 1 ? [0, nums[0], 1] : [nums[0], nums[1], nums[2] ?? 1];
    if (stepVal === 0) throw new ScriptError('range() の step に 0 は使えません', line);
    const out: number[] = [];
    for (let i = start; stepVal > 0 ? i < stop : i > stop; i += stepVal) {
      out.push(i);
      if (out.length > 10_000) throw new ScriptError('range() が大きすぎます（上限 10000 要素）', line);
    }
    return out;
  },
};
