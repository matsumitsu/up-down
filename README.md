# UP/DOWN

エレベーターの制御コードを書いて、ビルに来る客を運ぶ **プログラミング × インクリメンタルゲーム** です。

- 目的：**できるだけ多くの来客を捌く**こと
- 核心：**ビルが育つほど、今までのロジックが通用しなくなる**こと

▶ **遊ぶ：** https://matsumitsu.github.io/up-down/

---

## 遊び方

1. 右上の「制御コード」に、エレベーターの動かし方を書きます（最初から簡単なコードが入っています）。
2. 「適用」ボタン（または `Ctrl+Enter` / `Cmd+Enter`。エディタの外にフォーカスがあっても使えます）でコードが反映されます。
3. 客が各階に現れ、行き先の階へ向かおうとします。目的の階まで運ぶたびに 💰 が入ります。
4. 待ちすぎた客（約40秒）は帰ってしまい、その分の 💰 はもらえません。
5. 💰 でショップのアップグレードを買います。階が増えると客も増え、今までのコードでは捌ききれなくなります。コードを書き直しましょう。

### エディタ

- 入力すると補完の候補が出ます。`Enter` または `Tab` で確定します（`Ctrl+Space` で手動で呼び出せます）。
- `elevator.` のように `.` を打つと、そのかごのメソッド・フィールドが出ます。イベントの引数・`for x in elevators`・`x = elevators[0]` などから、変数がかごかリストかを推測します。
- まだ解放していない API も 🔒 付きで候補に出ます。
- 行頭で `def` と打つと、まだ書いていないイベント関数のひな形が出ます。
- ショップでイベント付きの API（呼び出しボタン・車内ボタン）を解放すると、そのイベント関数が中身 `pass` でコードの末尾に自動で追加されます（適用は自分で行います）。

### 画面の見方

| 表示 | 意味 |
| --- | --- |
| 青い四角 | 移動中のかご（`3/4` は乗っている人数／定員） |
| 緑の四角 | 扉が開いているかご |
| 灰色の四角 | 空いて止まっているかご |
| かごの中の点 | 乗っている客（白＝上へ、橙＝下へ） |
| 黄色の小さな印 | そのかごの行き先の予定 |
| 右側の丸 | 待っている客。数字は行き先の階、色は残りの忍耐（緑→赤） |

右上の「×1 / ×2 / ×4」でゲームの速さを変えられます。

### ショップ

| 項目 | 効果 |
| --- | --- |
| 階を増やす | ビルが1階分高くなる。来客が増える |
| エレベーターを増やす | かごが1台増える |
| 速度アップ | かごの移動速度が上がる |
| 定員アップ | かごに乗れる人数が増える |
| 呼び出しボタン API | `on_call`, `waiting()`, `calls()` が使える |
| 車内ボタン API | `on_button`, `elevator.pressed` が使える |
| ループ構文 | `for`, `while`, `break`, `continue`, `range()` が使える |
| キュー操作 API | `elevator.queue`, `elevator.stop()`, `elevator.go_now()` が使える |

価格などの数値はすべて [`src/data/balance.ts`](src/data/balance.ts) にまとまっています。

### セーブ

進行状況（💰、アップグレード、適用中のコード、書きかけのコード）はブラウザの localStorage に自動保存されます（10秒ごと、購入・適用時、ページを閉じるとき）。
最初からやり直すには右上の「リセット」を押してください。

---

## 言語の仕様

安全のため、JavaScript の `eval` などは使わず、**小さな Python 風の独自言語** をインタプリタで実行しています。

### 例

```python
# かごが止まって、行き先の予定がなくなったら呼ばれる
def on_idle(elevator):
    if elevator.floor < floors - 1:
        elevator.go_to(elevator.floor + 1)
    else:
        elevator.go_to(0)
```

```python
# 「呼び出しボタン API」と「車内ボタン API」を解放した後の例
def on_call(floor, direction):
    elevators[floor % len(elevators)].go_to(floor)

def on_button(elevator, floor):
    elevator.go_to(floor)

def on_idle(elevator):
    if elevator.floor != 0:
        elevator.go_to(0)
```

### イベント

決まった名前の関数を定義すると、ゲームから呼ばれます。引数は先頭から必要な数だけ受け取れます（`def on_arrive(elevator):` のように省略可）。

| 関数 | 呼ばれるとき | 解放 |
| --- | --- | --- |
| `on_idle(elevator)` | かごが止まり、行き先の予定がなくなったとき（止まるたびに1回だけ。ゲーム開始時と「適用」したときにも、止まっているかごに1回） | 最初から |
| `on_arrive(elevator, floor)` | かごが階に着いて扉が開いたとき | 最初から |
| `on_tick(elevator)` | 1秒ごと。かごごとに、動いているかどうかに関係なく呼ばれる | 最初から |
| `on_call(floor, direction)` | 客が現れたとき。`direction` は `"up"` か `"down"` | 呼び出しボタン API |
| `on_button(elevator, floor)` | 客が乗って行き先ボタンを押したとき | 車内ボタン API |

### かご（`elevator`）

| 名前 | 内容 | 解放 |
| --- | --- | --- |
| `elevator.go_to(floor)` | 行き先の予定の**最後**に階を追加する | 最初から |
| `elevator.floor` | 今いる（いちばん近い）階 | 最初から |
| `elevator.load` | 乗っている人数 | 最初から |
| `elevator.capacity` | 定員 | 最初から |
| `elevator.id` | かごの番号（0から） | 最初から |
| `elevator.pressed` | 車内で押されている階のリスト（昇順） | 車内ボタン API |
| `elevator.queue` | 行き先の予定のリスト（コピー。書き換えても反映されない） | キュー操作 API |
| `elevator.go_now(floor)` | 予定の**先頭**に割り込ませる | キュー操作 API |
| `elevator.stop()` | 予定をすべて消す（移動中なら進行方向の次の階で止まる） | キュー操作 API |

かごは予定の先頭の階へまっすぐ向かい、途中の階には止まりません。止まった階では、降りる客が降り、待っている客が先に来た順に定員まで乗ります（向きは関係ありません）。

### グローバル

| 名前 | 内容 | 解放 |
| --- | --- | --- |
| `floors` | 階数（0階＝ロビー 〜 `floors - 1` 階） | 最初から |
| `elevators` | すべてのかごのリスト | 最初から |
| `waiting(floor)` | その階で待っている人数 | 呼び出しボタン API |
| `calls()` | 客が待っている階のリスト | 呼び出しボタン API |
| `range(n)`, `range(a, b)`, `range(a, b, step)` | 数のリスト | ループ構文 |
| `print(...)` | コンソールに出力 | 最初から |
| `len`, `abs`, `min`, `max`, `int`, `str`, `round` | Python と同様 | 最初から |

### 構文

- 値：数値（`1`, `2.5`）、文字列（`"abc"`, `'abc'`）、`True` / `False` / `None`、リスト（`[1, 2, 3]`）
- 演算：`+ - * / // % **`、比較 `== != < > <= >=`、`and or not`、`in` / `not in`
- 文：代入（`=`, `+=`, `-=`, `*=`, `/=`）、`if` / `elif` / `else`、`def` / `return`、`pass`、`# コメント`
- ループ構文の解放後：`for x in リスト:`、`while 条件:`、`break`、`continue`
- リストの操作：`a[i]`（負の添字も可）、`a[i] = x`、`a.append(x)`、`a.pop()`、`a.insert(i, x)`、`a.remove(x)`
- ブロックはインデント（スペース・タブ）で表します。

### Python との違い

- トップレベルで作った変数は**全イベントで共有され、ずっと残ります**。関数の中で、すでにある変数に代入するとそのグローバル変数が書き換わります（`global` 宣言は不要・非対応）。関数の中で新しく作った変数はその関数の中だけで使えます。
- 関数の中に関数は定義できません。クラス、辞書、タプル、スライス、例外処理、`import` はありません。
- 比較の連結（`a < b < c`）は使えません。

### エラーと安全装置

- 文法エラーや、解放していない構文・イベントを使うと「適用」に失敗し、**それまでのコードが動き続けます**。
- 実行中のエラー（未定義の名前、存在しない階など）が起きても、ゲームは止まらず、その回のイベント処理だけが中断されます。
- 1回のイベント処理は 20,000 ステップまで、関数呼び出しの深さは 64 までです。超えると無限ループとして中断されます。
- エラーは行番号付きで、エディタ上（赤い印）とエディタの下に表示されます。

---

## 開発

必要なもの：Node.js 22 以上

```bash
npm install          # 依存関係のインストール
npm run dev          # 開発サーバー（http://localhost:5173）
npm run build        # 型チェック＋本番ビルド（dist/）
npm run typecheck    # 型チェック
npm run lint         # ESLint
npm test             # ユニットテスト（Vitest）
npx playwright install chromium  # 初回のみ
npm run test:e2e     # E2E テスト（Playwright。ビルドして preview サーバーで確認）
```

### ディレクトリ構成

```
src/
  data/balance.ts      数値バランス・初期コード（調整はここだけ）
  sim/                 ゲームロジック（DOM・描画に依存しない。Node.js でテスト可能）
    api.ts             プレイヤーが使える API の定義（リファレンス・補完・ひな形の元）
    lang/              Python 風言語（lexer → parser → interpreter）
    simulation.ts      ビル・かご・客のシミュレーション
    script.ts          プレイヤーのコードとシミュレーションの橋渡し・API の解放
    game.ts            お金・アップグレード・セーブ用データをまとめたゲーム本体
    save.ts            セーブデータの形式と検証
    upgrades.ts        価格とレベルから決まる値
  ui/                  Canvas 描画・CodeMirror エディタ（補完は completions.ts）・ショップ
  main.ts              ブラウザのエントリーポイント
tests/                 Vitest（ロジック）
e2e/                   Playwright（起動して遊べるか）
```

- シミュレーションは 1/20 秒刻みの固定ステップで進みます。乱数はシード付きなので、テストでは結果を再現できます。
- デバッグ用に、ブラウザのコンソールから `window.__upDown` でゲームの状態にアクセスできます。

### CI / デプロイ

GitHub Actions（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）で、push・PR ごとに型チェック、Lint、Vitest、Playwright を実行します。
`main` ブランチでは、テストが通ると GitHub Pages にデプロイします（リポジトリの Settings → Pages の Source を「GitHub Actions」にしておく必要があります）。
