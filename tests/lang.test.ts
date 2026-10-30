import { describe, expect, it } from 'vitest';
import { ScriptError, tokenize } from '../src/sim/lang/lexer';
import { parse } from '../src/sim/lang/parser';
import { Interpreter, rangeBuiltin, standardBuiltins, type Value } from '../src/sim/lang/interpreter';

/** コードを実行し、print の出力を返す */
function run(code: string, { loops = true, maxSteps = 10_000 } = {}): string[] {
  const out: string[] = [];
  const builtins = standardBuiltins((t) => out.push(t));
  if (loops) builtins.set('range', rangeBuiltin);
  const it = new Interpreter({ maxSteps, maxDepth: 32, builtins });
  it.runProgram(parse(code, { allowLoops: loops }));
  return out;
}

function errorOf(fn: () => unknown): ScriptError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ScriptError) return e;
    throw e;
  }
  throw new Error('エラーになりませんでした');
}

describe('字句解析', () => {
  it('インデントを INDENT / DEDENT に変換する', () => {
    const types = tokenize('if x:\n    y\nz\n').map((t) => t.type);
    expect(types).toEqual(['name', 'name', 'op', 'newline', 'indent', 'name', 'newline', 'dedent', 'name', 'newline', 'eof']);
  });

  it('不正な文字は行番号付きでエラー', () => {
    const e = errorOf(() => tokenize('a = 1\nb = $'));
    expect(e.line).toBe(2);
  });

  it('括弧の中の改行は無視する', () => {
    expect(run('x = [1,\n  2,\n  3]\nprint(len(x))')).toEqual(['3']);
  });
});

describe('式と文', () => {
  it('四則演算と優先順位', () => {
    expect(run('print(1 + 2 * 3, (1 + 2) * 3, 7 // 2, -7 % 3, 2 ** 3, 7 / 2)')).toEqual(['7 9 3 2 8 3.5']);
  });

  it('比較・論理演算・in', () => {
    expect(run('print(1 < 2 and 3 >= 3, not True or False, 2 in [1, 2], 5 not in [1])')).toEqual([
      'True False True True',
    ]);
  });

  it('if / elif / else', () => {
    const code = 'def f(x):\n    if x < 0:\n        return "負"\n    elif x == 0:\n        return "ゼロ"\n    else:\n        return "正"\nprint(f(-1), f(0), f(5))';
    expect(run(code)).toEqual(['負 ゼロ 正']);
  });

  it('for / while / break / continue', () => {
    const code = [
      'total = 0',
      'for i in range(10):',
      '    if i % 2 == 0:',
      '        continue',
      '    total += i',
      'n = 0',
      'while True:',
      '    n += 1',
      '    if n >= 5:',
      '        break',
      'print(total, n)',
    ].join('\n');
    expect(run(code)).toEqual(['25 5']);
  });

  it('リストの操作', () => {
    const code = 'a = [3, 1]\na.append(2)\na.insert(0, 9)\na.remove(1)\nx = a.pop()\na[0] = 7\nprint(a, x, a[-1], len(a))';
    expect(run(code)).toEqual(['[7, 3] 2 3 2']);
  });

  it('関数の中から既存のグローバル変数を書き換えられる', () => {
    expect(run('count = 0\ndef inc():\n    count += 1\ninc()\ninc()\nprint(count)')).toEqual(['2']);
  });

  it('関数内の新しい変数はローカル', () => {
    const e = errorOf(() => run('def f():\n    tmp = 1\nf()\nprint(tmp)'));
    expect(e.line).toBe(4);
  });

  it('組み込み関数', () => {
    expect(run('print(abs(-3), min(4, 2), max([1, 9]), int("12"), round(2.6), str(5) + "階")')).toEqual(['3 2 9 12 3 5階']);
  });
});

describe('エラー', () => {
  it('構文エラーに行番号がつく', () => {
    const e = errorOf(() => parse('x = 1\nif x\n    pass', { allowLoops: true }));
    expect(e.line).toBe(2);
  });

  it('未定義の名前は実行時エラー（行番号つき）', () => {
    const e = errorOf(() => run('x = 1\n\ny = zzz + 1'));
    expect(e.line).toBe(3);
    expect(e.message).toContain('zzz');
  });

  it('0 除算', () => {
    expect(errorOf(() => run('print(1 / 0)')).message).toContain('0 で割る');
  });

  it('文字列と数値の連結', () => {
    expect(errorOf(() => run('print("a" + 1)')).message).toContain('str()');
  });

  it('無限ループはステップ上限で止まる', () => {
    const e = errorOf(() => run('x = 0\nwhile True:\n    x += 1', { maxSteps: 1000 }));
    expect(e.message).toContain('無限ループ');
    expect(e.line).toBeGreaterThanOrEqual(2);
  });

  it('無限再帰は深さ上限で止まる', () => {
    expect(errorOf(() => run('def f():\n    f()\nf()')).message).toContain('深すぎます');
  });

  it('ループ構文が未解放なら for / while は構文エラー', () => {
    const e = errorOf(() => parse('x = 1\nfor i in [1]:\n    pass', { allowLoops: false }));
    expect(e.line).toBe(2);
    expect(e.message).toContain('ループ構文');
  });

  it('ループの外の break はエラー', () => {
    expect(errorOf(() => parse('break', { allowLoops: true })).message).toContain('ループの中');
  });

  it('引数の数の間違い', () => {
    expect(errorOf(() => run('def f(a):\n    pass\nf(1, 2)')).line).toBe(3);
  });

  it('解放前の名前には案内付きエラー', () => {
    const it = new Interpreter({
      maxSteps: 100,
      maxDepth: 10,
      builtins: new Map<string, Value>(),
      lockedNames: new Map([['secret', "'secret' はまだ使えません"]]),
    });
    expect(errorOf(() => it.runProgram(parse('secret()', { allowLoops: false }))).message).toContain('まだ使えません');
  });
});
