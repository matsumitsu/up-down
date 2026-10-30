/** 「使える API」一覧。src/sim/api.ts の定義から作り、解放状態に応じて 🔒 を付ける */
import type { FeatureId } from '../data/balance';
import { ELEVATOR_MEMBERS, EVENT_DEFS, GLOBAL_DEFS, KEYWORD_DEFS } from '../sim/api';
import { featureDef } from '../sim/upgrades';

interface RefItem {
  code: string;
  text: string;
  feature: FeatureId | null;
}

function items(): RefItem[] {
  const sig = (params?: string[]) => (params ? `(${params.join(', ')})` : '');
  return [
    ...EVENT_DEFS.map((e) => ({ code: `def ${e.name}${sig(e.params)}:`, text: e.description, feature: e.feature })),
    ...ELEVATOR_MEMBERS.map((m) => ({ code: `elevator.${m.name}${sig(m.params)}`, text: m.description, feature: m.feature })),
    ...GLOBAL_DEFS.map((g) => ({ code: `${g.name}${sig(g.params)}`, text: g.description, feature: g.feature })),
    {
      code: KEYWORD_DEFS.filter((k) => k.feature === 'loops').map((k) => k.name).join(' / '),
      text: 'ループ構文',
      feature: 'loops',
    },
  ];
}

export function renderReference(container: HTMLElement, features: Set<FeatureId>): void {
  container.replaceChildren(
    ...items().map((item) => {
      const row = document.createElement('div');
      const locked = item.feature && !features.has(item.feature);
      row.className = locked ? 'ref locked' : 'ref';
      const code = document.createElement('code');
      code.textContent = item.code;
      const text = document.createElement('span');
      text.textContent = locked ? `🔒 ${featureDef(item.feature!).name}` : item.text;
      row.append(code, text);
      return row;
    }),
  );
}
