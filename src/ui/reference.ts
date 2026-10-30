/** 「使える API」一覧。src/sim/api.ts の定義から作り、解放状態に応じて 🔒 を付ける */
import type { FeatureId } from '../data/balance';
import { ELEVATOR_MEMBERS, EVENT_DEFS, GLOBAL_DEFS, KEYWORD_DEFS } from '../sim/api';
import { featureDef } from '../sim/upgrades';

interface RefItem {
  code: string;
  text: string;
  feature: FeatureId | null;
}

interface RefSection {
  title: string;
  note: string;
  items: RefItem[];
}

function sections(): RefSection[] {
  const sig = (params?: string[]) => (params ? `(${params.join(', ')})` : '');
  return [
    {
      title: 'イベント',
      note: 'この名前で関数を定義すると、出来事が起きたときに呼ばれます。',
      items: EVENT_DEFS.map((e) => ({ code: `def ${e.name}${sig(e.params)}:`, text: e.description, feature: e.feature })),
    },
    {
      title: 'エレベーター（elevator.〜）',
      note: 'イベントの引数や elevators[i] で受け取ったかごに使えます。',
      items: ELEVATOR_MEMBERS.map((m) => ({ code: `elevator.${m.name}${sig(m.params)}`, text: m.description, feature: m.feature })),
    },
    {
      title: '関数・定数',
      note: '',
      items: GLOBAL_DEFS.map((g) => ({ code: `${g.name}${sig(g.params)}`, text: g.description, feature: g.feature })),
    },
    {
      title: '構文',
      note: '',
      items: [
        {
          code: KEYWORD_DEFS.filter((k) => !k.feature).map((k) => k.name).join(' '),
          text: '最初から使える構文',
          feature: null,
        },
        {
          code: KEYWORD_DEFS.filter((k) => k.feature === 'loops').map((k) => k.name).join(' / '),
          text: 'ループ構文',
          feature: 'loops',
        },
      ],
    },
  ];
}

export function renderReference(container: HTMLElement, features: Set<FeatureId>): void {
  const nodes: HTMLElement[] = [];
  for (const section of sections()) {
    const h = document.createElement('h3');
    h.textContent = section.title;
    nodes.push(h);
    if (section.note) {
      const note = document.createElement('div');
      note.className = 'ref-note';
      note.textContent = section.note;
      nodes.push(note);
    }
    for (const item of section.items) {
      const row = document.createElement('div');
      const locked = item.feature && !features.has(item.feature);
      row.className = locked ? 'ref locked' : 'ref';
      const code = document.createElement('code');
      code.textContent = item.code;
      const text = document.createElement('span');
      text.textContent = locked ? `🔒 ショップの「${featureDef(item.feature!).name}」で解放` : item.text;
      row.append(code, text);
      nodes.push(row);
    }
  }
  container.replaceChildren(...nodes);
}
