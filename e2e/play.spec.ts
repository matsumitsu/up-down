import { expect, test, type Page } from '@playwright/test';

/** 画面上の数値を読む（カンマ区切りを考慮） */
async function numberOf(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).textContent();
  return Number((text ?? '').replace(/,/g, ''));
}

/** エディタの中身を置き換える（insertText は自動インデントの影響を受けない） */
async function setCode(page: Page, code: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
  await expect(page.locator('.cm-content')).toContainText(code.split('\n')[0]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('起動すると初期コードのままで客が運ばれ、お金が増える', async ({ page }) => {
  await expect(page.getByTestId('building')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('def on_idle');
  await page.getByRole('button', { name: '×4' }).click();
  await expect.poll(() => numberOf(page, 'delivered'), { timeout: 40_000 }).toBeGreaterThan(0);
  await expect.poll(() => numberOf(page, 'money'), { timeout: 10_000 }).toBeGreaterThan(0);
});

test('コードを書き換えて適用すると動きが変わる', async ({ page }) => {
  await setCode(page, 'def on_idle(elevator):\n    elevator.go_to(2)\n');
  await page.getByTestId('apply').click();
  await expect(page.getByTestId('script-errors')).toContainText('適用しました');
  await expect
    .poll(() => page.evaluate(() => (window as never as { __upDown: { sim: { elevators: { y: number }[] } } }).__upDown.sim.elevators[0].y), {
      timeout: 15_000,
    })
    .toBe(2);
  // 初期コードなら扉が閉まると下へ戻るが、新しいコードでは 2 階に留まり続ける
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as never as { __upDown: { sim: { elevators: { y: number }[] } } }).__upDown.sim.elevators[0].y)).toBe(2);
});

test('エラーは行番号付きで表示され、ゲームは止まらない', async ({ page }) => {
  await setCode(page, 'def on_idle(elevator):\n    elevator.go_to(\n');
  await page.getByTestId('apply').click();
  await expect(page.getByTestId('script-errors')).toContainText('行目');
  await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible();

  await setCode(page, 'def on_idle(elevator):\n    x = 1\n    elevator.go_to(x + undefined_name)\n');
  await page.getByTestId('apply').click();
  await expect(page.getByTestId('script-errors')).toContainText('3 行目');
  await expect(page.getByTestId('script-errors')).toContainText('undefined_name');
});

test('アップグレードを買うとビルが変化する', async ({ page }) => {
  await expect(page.getByTestId('building-info')).toContainText('3階 / 1台');
  await expect(page.getByTestId('buy-floors')).toBeDisabled();
  await page.evaluate(() => {
    (window as never as { __upDown: { money: number } }).__upDown.money = 10_000;
  });
  await page.getByTestId('buy-floors').click();
  await page.getByTestId('buy-elevators').click();
  await expect(page.getByTestId('building-info')).toContainText('4階 / 2台');
  await page.getByTestId('buy-loops').click();
  await expect(page.getByTestId('buy-loops')).toHaveText('済');
});

test('セーブされ、再読み込みしても続きから遊べる', async ({ page }) => {
  await page.evaluate(() => {
    (window as never as { __upDown: { money: number } }).__upDown.money = 1_000;
  });
  await page.getByTestId('buy-capacity').click();
  await page.reload();
  await expect(page.getByTestId('building-info')).toContainText('定員 6');
});
