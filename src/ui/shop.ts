/** ショップの表示。項目は一度だけ作り、状態（価格・買えるか）を定期的に更新する */
import { BALANCE } from '../data/balance';
import type { Game, PurchaseId } from '../sim/game';
import { formatMoney } from './format';

interface ShopRow {
  id: PurchaseId;
  button: HTMLButtonElement;
  level: HTMLElement;
}

export class Shop {
  private readonly rows: ShopRow[] = [];

  constructor(
    container: HTMLElement,
    private readonly game: Game,
    onBought: (id: PurchaseId) => void,
  ) {
    const addSection = (title: string) => {
      const h = document.createElement('h3');
      h.textContent = title;
      container.append(h);
    };
    const addRow = (id: PurchaseId, name: string, description: string) => {
      const row = document.createElement('div');
      row.className = 'shop-item';
      const info = document.createElement('div');
      info.className = 'shop-info';
      const title = document.createElement('div');
      title.className = 'shop-name';
      title.textContent = name;
      const level = document.createElement('span');
      level.className = 'shop-level';
      title.append(' ', level);
      const desc = document.createElement('div');
      desc.className = 'shop-desc';
      desc.textContent = description;
      info.append(title, desc);
      const button = document.createElement('button');
      button.dataset.testid = `buy-${id}`;
      button.addEventListener('click', () => {
        if (this.game.buy(id)) {
          onBought(id);
          this.update();
        }
      });
      row.append(info, button);
      container.append(row);
      this.rows.push({ id, button, level });
    };

    addSection('ビル・エレベーター');
    for (const u of BALANCE.levelUpgrades) addRow(u.id, u.name, u.description);
    addSection('構文・API の解放');
    for (const f of BALANCE.featureUnlocks) addRow(f.id, f.name, f.description);
    this.update();
  }

  update(): void {
    for (const row of this.rows) {
      const cost = this.game.cost(row.id);
      const def = BALANCE.levelUpgrades.find((u) => u.id === row.id);
      if (def) {
        row.level.textContent = `Lv ${this.game.levels[def.id]}/${def.maxLevel}`;
      } else {
        row.level.textContent = cost === null ? '✅ 解放済み' : '🔒';
      }
      const label = cost === null ? (def ? '最大' : '済') : `💰 ${formatMoney(cost)}`;
      if (row.button.textContent !== label) row.button.textContent = label;
      row.button.disabled = cost === null || this.game.money < cost;
    }
  }
}
