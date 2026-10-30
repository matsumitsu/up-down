/** アップグレードの価格と、レベルから決まる各種の値 */
import { BALANCE, type FeatureId, type LevelUpgradeId } from '../data/balance';

export type UpgradeLevels = Record<LevelUpgradeId, number>;

export function initialLevels(): UpgradeLevels {
  return { floors: 0, elevators: 0, speed: 0, capacity: 0 };
}

export function levelUpgradeDef(id: LevelUpgradeId) {
  const def = BALANCE.levelUpgrades.find((u) => u.id === id);
  if (!def) throw new Error(`未知のアップグレード: ${id}`);
  return def;
}

export function featureDef(id: FeatureId) {
  const def = BALANCE.featureUnlocks.find((u) => u.id === id);
  if (!def) throw new Error(`未知の機能: ${id}`);
  return def;
}

/** 次のレベルの価格。最大レベルなら null */
export function levelUpgradeCost(id: LevelUpgradeId, currentLevel: number): number | null {
  const def = levelUpgradeDef(id);
  if (currentLevel >= def.maxLevel) return null;
  return Math.round(def.baseCost * def.costGrowth ** currentLevel);
}

export interface DerivedStats {
  floors: number;
  elevators: number;
  speed: number;
  capacity: number;
}

export function deriveStats(levels: UpgradeLevels): DerivedStats {
  const e = BALANCE.elevator;
  return {
    floors: BALANCE.building.initialFloors + levels.floors,
    elevators: BALANCE.building.initialElevators + levels.elevators,
    speed: e.baseSpeed + e.speedPerLevel * levels.speed,
    capacity: e.baseCapacity + e.capacityPerLevel * levels.capacity,
  };
}
