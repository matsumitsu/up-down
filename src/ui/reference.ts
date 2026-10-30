/** 「使える API」一覧。解放状態に応じて 🔒 を付ける */
import type { FeatureId } from '../data/balance';
import { featureDef } from '../sim/upgrades';

interface RefItem {
  code: string;
  text: string;
  feature?: FeatureId;
}

const ITEMS: RefItem[] = [
  { code: 'def on_idle(elevator):', text: 'かごが空いて止まったとき（その後も1秒ごと）' },
  { code: 'def on_arrive(elevator, floor):', text: 'かごが階に着いて扉が開いたとき' },
  { code: 'def on_call(floor, direction):', text: '客が現れたとき（direction は "up" / "down"）', feature: 'calls' },
  { code: 'def on_button(elevator, floor):', text: '客が乗って行き先ボタンを押したとき', feature: 'buttons' },
  { code: 'elevator.go_to(floor)', text: '行き先の予定の最後に階を追加' },
  { code: 'elevator.floor / .load / .capacity / .id', text: '今の階・乗っている人数・定員・番号' },
  { code: 'elevator.pressed', text: '車内で押されている階のリスト', feature: 'buttons' },
  { code: 'elevator.queue', text: '行き先の予定（コピー）', feature: 'queue' },
  { code: 'elevator.go_now(floor)', text: '予定の先頭に割り込む', feature: 'queue' },
  { code: 'elevator.stop()', text: '予定をすべて消す', feature: 'queue' },
  { code: 'floors / elevators', text: '階数・全エレベーターのリスト' },
  { code: 'waiting(floor) / calls()', text: 'その階で待つ人数・客がいる階のリスト', feature: 'calls' },
  { code: 'for / while / break / continue / range()', text: 'ループ構文', feature: 'loops' },
  { code: 'print len abs min max int str round', text: '組み込み関数' },
];

export function renderReference(container: HTMLElement, features: Set<FeatureId>): void {
  container.replaceChildren(
    ...ITEMS.map((item) => {
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
