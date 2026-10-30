/**
 * エディタの補完（インテリセンス）。
 * Python 標準の補完の代わりに、このゲームの言語と API に合わせた候補を出す。
 * DOM には依存しないので Node.js でもテストできる。
 */
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { FeatureId } from '../data/balance';
import { ELEVATOR_MEMBERS, EVENT_DEFS, GLOBAL_DEFS, KEYWORD_DEFS, LIST_MEMBERS, type MemberDef } from '../sim/api';
import { featureDef } from '../sim/upgrades';

type ValueKind = 'elevator' | 'list' | 'unknown';

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

function lockedDetail(feature: FeatureId | null, features: ReadonlySet<FeatureId>): string | null {
  return feature && !features.has(feature) ? `🔒 ${featureDef(feature).name}` : null;
}

/** 受け手の式（例：elevator, elevators[0], e）がどんな値かをコードから推測する */
export function inferKind(receiver: string, doc: string): ValueKind {
  if (/^elevators\s*\[.*\]$/.test(receiver)) return 'elevator';
  if (receiver === 'elevators') return 'list';
  if (!new RegExp(`^${IDENT}$`).test(receiver)) return 'unknown';

  const name = receiver;
  // イベント関数の引数のうち、エレベーターが渡されるもの
  for (const def of EVENT_DEFS) {
    const m = new RegExp(`^\\s*def\\s+${def.name}\\s*\\(([^)]*)\\)`, 'm').exec(doc);
    if (!m) continue;
    const params = m[1].split(',').map((p) => p.trim());
    if (def.elevatorParams.some((i) => params[i] === name)) return 'elevator';
  }
  if (new RegExp(`^\\s*for\\s+${name}\\s+in\\s+elevators\\s*:`, 'm').test(doc)) return 'elevator';
  const assign = new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'gm');
  let kind: ValueKind = 'unknown';
  for (const m of doc.matchAll(assign)) {
    const value = m[1].trim();
    if (/^elevators\s*\[.*\]$/.test(value)) kind = 'elevator';
    else if (/^\[/.test(value) || /^(calls|range)\s*\(/.test(value) || /\.(pressed|queue)$/.test(value) || value === 'elevators')
      kind = 'list';
  }
  return kind;
}

function memberOption(m: MemberDef, features: ReadonlySet<FeatureId>, boost: number): Completion {
  const locked = lockedDetail(m.feature, features);
  const signature = m.kind === 'method' ? `(${(m.params ?? []).join(', ')})` : '';
  const base = {
    label: m.name,
    detail: locked ?? signature,
    info: m.description,
    type: m.kind,
    boost: locked ? boost - 50 : boost,
  };
  if (m.kind === 'method' && !locked) {
    const args = (m.params ?? []).map((p) => `\${${p}}`).join(', ');
    return snippetCompletion(`${m.name}(${args})`, base);
  }
  return base;
}

/** コード中でプレイヤーが定義した名前（変数・関数・引数・ループ変数） */
export function userNames(doc: string): string[] {
  const names = new Set<string>();
  for (const m of doc.matchAll(new RegExp(`^\\s*(${IDENT})\\s*(?:=|\\+=|-=|\\*=|/=)(?!=)`, 'gm'))) names.add(m[1]);
  for (const m of doc.matchAll(new RegExp(`^\\s*def\\s+(${IDENT})\\s*\\(([^)]*)\\)`, 'gm'))) {
    names.add(m[1]);
    for (const p of m[2].split(',')) if (p.trim()) names.add(p.trim());
  }
  for (const m of doc.matchAll(new RegExp(`^\\s*for\\s+(${IDENT})\\s+in\\b`, 'gm'))) names.add(m[1]);
  return [...names];
}

export function createCompletionSource(getFeatures: () => ReadonlySet<FeatureId>) {
  return (context: CompletionContext): CompletionResult | null => {
    const features = getFeatures();
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);

    // コメントや文字列の中では補完しない
    if (/#/.test(before.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ''))) return null;
    if ((before.match(/["']/g)?.length ?? 0) % 2 === 1) return null;

    // 「受け手.」の後：メンバーの候補
    const member = new RegExp(`(${IDENT}(?:\\s*\\[[^\\]]*\\])?)\\.(${IDENT})?$`).exec(before);
    if (member) {
      const doc = context.state.doc.toString();
      const kind = inferKind(member[1].replace(/\s+/g, ''), doc);
      const options: Completion[] = [];
      if (kind !== 'list') options.push(...ELEVATOR_MEMBERS.map((m) => memberOption(m, features, 10)));
      if (kind !== 'elevator') options.push(...LIST_MEMBERS.map((m) => memberOption(m, features, kind === 'list' ? 10 : 0)));
      return {
        from: context.pos - (member[2]?.length ?? 0),
        options,
        validFor: new RegExp(`^${IDENT}?$`),
      };
    }

    const word = context.matchBefore(new RegExp(`${IDENT}$`));
    if (!word && !context.explicit) return null;
    // 数字の直後（例：1.5 の途中）では出さない
    if (word && /[0-9.]$/.test(before.slice(0, word.from - line.from))) return null;
    const from = word ? word.from : context.pos;
    const atLineStart = /^\s*$/.test(before.slice(0, from - line.from));
    const doc = context.state.doc.toString();
    const options: Completion[] = [];
    const seen = new Set<string>();
    const add = (c: Completion) => {
      if (seen.has(c.label)) return;
      seen.add(c.label);
      options.push(c);
    };

    // 行頭ならイベント関数のひな形（まだ定義していないもの）
    if (atLineStart) {
      for (const def of EVENT_DEFS) {
        if (new RegExp(`^\\s*def\\s+${def.name}\\s*\\(`, 'm').test(doc)) continue;
        const locked = lockedDetail(def.feature, features);
        const info = { label: `def ${def.name}`, detail: locked ?? `(${def.params.join(', ')})`, info: def.description, type: 'function', boost: locked ? -40 : 5 };
        add(locked ? info : snippetCompletion(`def ${def.name}(${def.params.join(', ')}):\n\t\${pass}`, info));
      }
    }
    for (const k of KEYWORD_DEFS) {
      const locked = lockedDetail(k.feature, features);
      add({ label: k.name, type: 'keyword', detail: locked ?? undefined, boost: locked ? -50 : -1 });
    }
    for (const g of GLOBAL_DEFS) {
      const locked = lockedDetail(g.feature, features);
      const signature = g.kind === 'function' ? `(${(g.params ?? []).join(', ')})` : '';
      add({
        label: g.name,
        type: g.kind === 'function' ? 'function' : 'constant',
        detail: locked ?? signature,
        info: g.description,
        boost: locked ? -50 : 0,
      });
    }
    // 入力中の単語そのものは候補にしない
    const current = word?.text;
    for (const name of userNames(doc)) {
      if (name !== current) add({ label: name, type: 'variable', boost: 2 });
    }
    return { from, options, validFor: new RegExp(`^${IDENT}$`) };
  };
}
