/** 数値を画面表示用に整える */
export function formatMoney(n: number): string {
  return Math.floor(n).toLocaleString('ja-JP');
}
