/**
 * プレイヤーが使える API の定義。
 * リファレンス表示・エディタの補完・イベント関数の自動追加は、すべてここを参照する。
 */
import type { FeatureId } from '../data/balance';

export interface EventDef {
  name: string;
  params: string[];
  /** 各引数がエレベーターかどうか（補完で型を推測するために使う） */
  elevatorParams: number[];
  description: string;
  /** 解放が必要な機能（null なら最初から使える） */
  feature: FeatureId | null;
}

export interface MemberDef {
  name: string;
  kind: 'method' | 'property';
  /** 引数（メソッドのみ） */
  params?: string[];
  description: string;
  feature: FeatureId | null;
}

export interface GlobalDef {
  name: string;
  kind: 'function' | 'constant';
  params?: string[];
  description: string;
  feature: FeatureId | null;
}

export const EVENT_DEFS: EventDef[] = [
  {
    name: 'on_idle',
    params: ['elevator'],
    elevatorParams: [0],
    description: 'かごが止まり、行き先の予定がなくなったとき（1回だけ）',
    feature: null,
  },
  {
    name: 'on_arrive',
    params: ['elevator', 'floor'],
    elevatorParams: [0],
    description: 'かごが階に着いて扉が開いたとき',
    feature: null,
  },
  {
    name: 'on_tick',
    params: ['elevator'],
    elevatorParams: [0],
    description: '1秒ごと（かごごとに、状態に関係なく）',
    feature: null,
  },
  {
    name: 'on_call',
    params: ['floor', 'direction'],
    elevatorParams: [],
    description: '客が現れたとき（direction は "up" / "down"）',
    feature: 'calls',
  },
  {
    name: 'on_button',
    params: ['elevator', 'floor'],
    elevatorParams: [0],
    description: '客が乗って行き先ボタンを押したとき',
    feature: 'buttons',
  },
];

export const ELEVATOR_MEMBERS: MemberDef[] = [
  { name: 'go_to', kind: 'method', params: ['floor'], description: '行き先の予定の最後に階を追加', feature: null },
  { name: 'floor', kind: 'property', description: '今いる（いちばん近い）階', feature: null },
  { name: 'load', kind: 'property', description: '乗っている人数', feature: null },
  { name: 'capacity', kind: 'property', description: '定員', feature: null },
  { name: 'id', kind: 'property', description: 'かごの番号（0から）', feature: null },
  { name: 'pressed', kind: 'property', description: '車内で押されている階のリスト', feature: 'buttons' },
  { name: 'queue', kind: 'property', description: '行き先の予定（コピー）', feature: 'queue' },
  { name: 'go_now', kind: 'method', params: ['floor'], description: '予定の先頭に割り込む', feature: 'queue' },
  { name: 'stop', kind: 'method', params: [], description: '予定をすべて消す', feature: 'queue' },
];

export const LIST_MEMBERS: MemberDef[] = [
  { name: 'append', kind: 'method', params: ['x'], description: '最後に追加', feature: null },
  { name: 'pop', kind: 'method', params: [], description: '最後（または指定位置）を取り出す', feature: null },
  { name: 'insert', kind: 'method', params: ['i', 'x'], description: '位置 i に挿入', feature: null },
  { name: 'remove', kind: 'method', params: ['x'], description: '最初に見つかった x を削除', feature: null },
];

export const GLOBAL_DEFS: GlobalDef[] = [
  { name: 'floors', kind: 'constant', description: '階数（0階＝ロビー 〜 floors - 1 階）', feature: null },
  { name: 'elevators', kind: 'constant', description: 'すべてのかごのリスト', feature: null },
  { name: 'waiting', kind: 'function', params: ['floor'], description: 'その階で待っている人数', feature: 'calls' },
  { name: 'calls', kind: 'function', params: [], description: '客が待っている階のリスト', feature: 'calls' },
  { name: 'range', kind: 'function', params: ['n'], description: '0 〜 n-1 のリスト（range(a, b, step) も可）', feature: 'loops' },
  { name: 'print', kind: 'function', params: ['x'], description: 'コンソールに出力', feature: null },
  { name: 'len', kind: 'function', params: ['x'], description: 'リスト・文字列の長さ', feature: null },
  { name: 'abs', kind: 'function', params: ['x'], description: '絶対値', feature: null },
  { name: 'min', kind: 'function', params: ['a', 'b'], description: '最小値（リスト1つでも可）', feature: null },
  { name: 'max', kind: 'function', params: ['a', 'b'], description: '最大値（リスト1つでも可）', feature: null },
  { name: 'int', kind: 'function', params: ['x'], description: '整数に変換', feature: null },
  { name: 'str', kind: 'function', params: ['x'], description: '文字列に変換', feature: null },
  { name: 'round', kind: 'function', params: ['x'], description: '四捨五入', feature: null },
];

/** 構文キーワードと、必要な機能 */
export const KEYWORD_DEFS: { name: string; feature: FeatureId | null }[] = [
  ...['def', 'if', 'elif', 'else', 'return', 'pass', 'and', 'or', 'not', 'in', 'True', 'False', 'None'].map((name) => ({
    name,
    feature: null,
  })),
  ...['for', 'while', 'break', 'continue'].map((name) => ({ name, feature: 'loops' as FeatureId })),
];

export function eventDef(name: string): EventDef | undefined {
  return EVENT_DEFS.find((e) => e.name === name);
}

/** 機能を解放すると使えるようになるイベント */
export function eventsUnlockedBy(feature: FeatureId): EventDef[] {
  return EVENT_DEFS.filter((e) => e.feature === feature);
}

/** イベント関数のひな形（中身は pass） */
export function eventStub(def: EventDef): string {
  return `def ${def.name}(${def.params.join(', ')}):\n    pass\n`;
}

/**
 * 機能の解放で使えるようになったイベント関数のひな形をコードの末尾に足す。
 * すでに同じ名前の関数が定義されていれば足さない。
 */
export function addEventStubs(code: string, feature: FeatureId): string {
  let result = code;
  for (const def of eventsUnlockedBy(feature)) {
    if (new RegExp(`^\\s*def\\s+${def.name}\\s*\\(`, 'm').test(result)) continue;
    const trimmed = result.replace(/\s+$/, '');
    result = `${trimmed}${trimmed ? '\n\n' : ''}${eventStub(def)}`;
  }
  return result;
}
