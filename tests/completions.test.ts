import { describe, expect, it } from 'vitest';
import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { FeatureId } from '../src/data/balance';
import { createCompletionSource, inferKind, userNames } from '../src/ui/completions';

/** "|" の位置で補完したときの候補のラベル */
function complete(textWithCursor: string, features: FeatureId[] = [], explicit = false) {
  const pos = textWithCursor.indexOf('|');
  const doc = textWithCursor.replace('|', '');
  const state = EditorState.create({ doc });
  const source = createCompletionSource(() => new Set(features));
  const result = source(new CompletionContext(state, pos, explicit));
  if (!result || result instanceof Promise) return null;
  return {
    from: result.from,
    labels: result.options.map((o) => o.label),
    detail: (label: string) => result.options.find((o) => o.label === label)?.detail,
  };
}

describe('メンバーの補完', () => {
  it('elevator. でエレベーターのメソッドとフィールドが出る', () => {
    const r = complete('def on_idle(elevator):\n    elevator.|');
    expect(r?.labels).toEqual(expect.arrayContaining(['go_to', 'floor', 'load', 'capacity', 'id']));
    expect(r?.labels).not.toContain('append');
  });

  it('入力途中の名前も補完対象になる', () => {
    const r = complete('def on_idle(e):\n    e.go|');
    expect(r?.from).toBe('def on_idle(e):\n    e.'.length);
    expect(r?.labels).toContain('go_to');
  });

  it('解放前のメンバーは 🔒 付きで出る', () => {
    const locked = complete('def on_idle(elevator):\n    elevator.|');
    expect(locked?.detail('pressed')).toContain('🔒');
    const unlocked = complete('def on_idle(elevator):\n    elevator.|', ['buttons']);
    expect(unlocked?.detail('pressed')).not.toContain('🔒');
  });

  it('elevators[0]. もエレベーター', () => {
    expect(complete('x = elevators[0].|')?.labels).toContain('go_to');
  });

  it('リストにはリストのメソッドが出る', () => {
    const r = complete('a = []\na.|');
    expect(r?.labels).toContain('append');
    expect(r?.labels).not.toContain('go_to');
  });
});

describe('名前の補完', () => {
  it('キーワード・組み込み・自分で定義した名前が出る', () => {
    const r = complete('count = 0\ndef on_idle(elevator):\n    co|');
    expect(r?.labels).toEqual(expect.arrayContaining(['count', 'elevator', 'floors', 'print', 'if']));
  });

  it('行頭では未定義のイベント関数のひな形が出る', () => {
    const r = complete('def on_idle(e):\n    pass\nde|');
    expect(r?.labels).toContain('def on_arrive');
    expect(r?.labels).not.toContain('def on_idle');
  });

  it('コメントや文字列の中では出ない', () => {
    expect(complete('# elevator.|')).toBeNull();
    expect(complete('print("elevator.|')).toBeNull();
  });

  it('何も入力していなければ（明示的に呼ばない限り）出ない', () => {
    expect(complete('x = |')).toBeNull();
    expect(complete('x = |', [], true)?.labels.length).toBeGreaterThan(0);
  });
});

describe('型の推測', () => {
  it('イベントの引数・for・代入から推測する', () => {
    const doc = 'def on_button(car, floor):\n    pass\nfor el in elevators:\n    pass\nfirst = elevators[0]\nlst = calls()';
    expect(inferKind('car', doc)).toBe('elevator');
    expect(inferKind('floor', doc)).toBe('unknown');
    expect(inferKind('el', doc)).toBe('elevator');
    expect(inferKind('first', doc)).toBe('elevator');
    expect(inferKind('lst', doc)).toBe('list');
  });

  it('定義した名前の一覧', () => {
    expect(userNames('a = 1\ndef f(x, y):\n    b += 1\nfor i in z:\n    pass\nif a == 1:\n    pass').sort()).toEqual(
      ['a', 'b', 'f', 'i', 'x', 'y'].sort(),
    );
  });
});
