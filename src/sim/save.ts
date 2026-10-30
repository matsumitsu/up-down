/** セーブデータの形式と、文字列との相互変換（localStorage には UI 側で書き込む） */
import type { FeatureId, LevelUpgradeId } from '../data/balance';
import { initialLevels, type UpgradeLevels } from './upgrades';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'up-down-save';

export interface SaveData {
  version: number;
  money: number;
  totalEarned: number;
  delivered: number;
  gaveUp: number;
  levels: UpgradeLevels;
  features: FeatureId[];
  /** 適用中のコード */
  appliedCode: string;
  /** エディタに書きかけのコード */
  draftCode: string;
}

/** 文字列の読み書きだけを要求する最小限のストレージ（localStorage と互換） */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const FEATURES: FeatureId[] = ['calls', 'buttons', 'loops', 'queue'];

export function serialize(data: SaveData): string {
  return JSON.stringify(data);
}

/** 壊れたデータや古い形式でも、読める部分だけ読んで安全な値を返す。読めなければ null */
export function deserialize(text: string | null): SaveData | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== SAVE_VERSION) return null;

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const levels = initialLevels();
  const rawLevels = (typeof r.levels === 'object' && r.levels) || {};
  for (const key of Object.keys(levels) as LevelUpgradeId[]) {
    levels[key] = Math.floor(num((rawLevels as Record<string, unknown>)[key]));
  }
  const features = Array.isArray(r.features) ? FEATURES.filter((f) => (r.features as unknown[]).includes(f)) : [];
  const appliedCode = typeof r.appliedCode === 'string' ? r.appliedCode : '';
  return {
    version: SAVE_VERSION,
    money: num(r.money),
    totalEarned: num(r.totalEarned),
    delivered: Math.floor(num(r.delivered)),
    gaveUp: Math.floor(num(r.gaveUp)),
    levels,
    features,
    appliedCode,
    draftCode: typeof r.draftCode === 'string' ? r.draftCode : appliedCode,
  };
}

export function saveTo(storage: KeyValueStorage, data: SaveData): void {
  storage.setItem(SAVE_KEY, serialize(data));
}

export function loadFrom(storage: KeyValueStorage): SaveData | null {
  return deserialize(storage.getItem(SAVE_KEY));
}
