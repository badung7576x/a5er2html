# a5er2html

**[English README is here (README.md)](README.md)**

[A5:SQL Mk-2](https://a5m2.mmatsubara.com/) の ER 図（`.a5er`）を、
ブラウザでそのまま開ける**単一の自己完結型 HTML ファイル**に変換します。
サーバー不要・ネットワーク接続不要・A5:SQL のインストールも不要です。

```console
$ python3 -m a5er2html meet_DB.a5er
OK  meet_DB.a5er -> meet_DB.html
    encoding=utf-8  format=21  pages=3  entities=42  relations=57  notes=6
```

![スクリーンショット](docs/screenshot.png)

## こんなときに

A5:SQL Mk-2 は日本の開発現場で広く使われている ER 図ツールですが、
`.a5er` ファイルをきちんと閲覧できるのはツール自身だけです。
スキーマをチームメンバーやレビュアー、オフショアのパートナーと共有したいとき、
画像や PDF をエクスポートするとすぐに内容が古くなってしまいます。

`a5er2html` は ER 図 1 つにつきポータブルな HTML ファイルを 1 つ生成します。
チャットで送る、チケットに添付する、`.a5er` の隣にコミットする——
受け取った人はブラウザで開くだけです。

## 特徴

- **完全オフライン出力** — 図のデータは HTML 内に JSON として埋め込まれます。ネットワークからは何も読み込みません。
- **文字コード自動判定** — `# A5:ER ENCODING:` 宣言を読み取り、UTF-8、BOM 付き UTF-8、Shift_JIS（CP932）に対応。宣言のない古いファイルも推定で読みます。
- **マルチページ対応** — A5:ER のページごとにタブを切り替えられます。
- **論理名 / 物理名の切り替え** — 論理名のみ・物理名のみ・両方の 3 モード。
- **リアルタイム検索** — テーブルとフィールドを絞り込み（論理名・物理名・型・コメントを検索）。マッチしないテーブルは薄く表示されます。
- **リレーション描画** — 鳥足（crow's foot）/ 1 本線の多重度マーカー付きの直交エッジ。可能な場合は FK フィールド行にアンカーします。
- **PK / FK マーク** — 主キーに 🔑、外部キーに 🔗 を表示。
- **ノート** — `[Note]` の付箋を該当ページに描画します。
- **パン / ズーム / フィット** — ドラッグ、ホイールズーム、キーボードショートカット。
- **依存ライブラリゼロ** — 純粋な Python 標準ライブラリのみ。オフラインで動作します。

## 動作環境

- Python **3.9 以上**（3.14 までテスト済み。標準ライブラリのみ使用 — `pip install` は不要です）
- 閲覧用にモダンなブラウザ（Chrome / Edge / Firefox / Safari）

## インストール

### 方法 A — リポジトリを取得してそのまま実行（インストール不要）

```console
$ git clone https://github.com/OWNER/a5er2html.git
$ cd a5er2html
$ python3 -m a5er2html path/to/input.a5er
```

### 方法 B — コマンドとしてインストール

```console
$ pipx install .          # クローンしたディレクトリ内で実行 — 推奨
# または
$ pip install .
```

インストールすると `a5er2html` コマンドが使えます:

```console
$ a5er2html input.a5er -o docs/schema.html
```

## 使い方

```
a5er2html input.a5er [-o output.html]
```

| オプション | 説明 |
|---|---|
| `input` | 変換元の `.a5er` ファイル |
| `-o, --output` | 出力先 `.html` パス（省略時: 変換元の隣に `<input名>.html`） |

終了コードは成功時 `0`、入出力エラー時 `1` です。
`[Entity]` が 1 つもないファイルでは警告を出しますが、空のビューアは生成されます。

### ビューアのショートカット

| キー / 操作 | 動作 |
|---|---|
| `ドラッグ` | パン（スクロール） |
| `ホイール` / `+` / `-` | ズーム |
| `0` | 画面にフィット |
| `1` | 100% 表示 |
| `/` | 検索ボックスにフォーカス |
| `Esc` | 検索 / 選択をクリア |
| テーブルをクリック | リレーションをハイライト |
| テーブル見出し / フィールド / エッジにホバー | 詳細ツールチップ（コメント、デフォルト値、多重度など） |

## サンプル

[`examples/`](examples/) ディレクトリにはテストスイートで使う小さな
サンプルデータベースがあります。そのまま動作デモとしても使えます:

| ファイル | 検証内容 |
|---|---|
| `sample-utf8.a5er` | 宣言付き UTF-8、2 ページ、ノート、エスケープ済み引用符、型・コメント内のカンマ |
| `sample-sjis.a5er` | 同じスキーマの Shift_JIS 版（`ENCODING:SJIS`） |
| `sample-sjis-nodecl.a5er` | 文字コード宣言の**ない** Shift_JIS（フォールバック推定） |
| `sample-edgecases.a5er` | BOM 付き UTF-8、フィールド 0 のエンティティ、ページ・位置情報なしのエンティティ、複合主キー、複数行コメント / ノート、存在しないテーブルへのリレーション、`ManyToMany` / `ManyToOne` / `N:1`、FORMAT 21 の `RelationType` コード、未知のセクション |
| `sample-empty.a5er` | エンティティが 1 つもないファイル |
| `sample-utf8.html` | `sample-utf8.a5er` のビルド済み出力 — 今すぐ開いてビューアを確認できます |

デモの再生成: `python3 -m a5er2html examples/sample-utf8.a5er`

## 仕組み

1. `a5er2html/parser.py` がファイルをデコードし（文字コード推定）、
   INI 形式のセクション（`[Manager]`、`[Entity]`、`[Relation]`、`[Note]`）を分割、
   引用符付き CSV 値（`Field=`、`Position=`、`PageInfo=`）をパースして、
   JSON 化可能な中間表現を生成します。
2. `a5er2html/cli.py` がその中間表現を
   `a5er2html/viewer_template.html` のプレースホルダ `__A5ER_DATA__` に注入します。
   JSON ペイロード内の `<` はエスケープされるため、`<script>` タグを
   乗り越えることはできません。
3. テンプレートは単一ファイルの HTML/CSS/JS アプリで、A5:ER の座標から
   エンティティカードをレイアウトし、直交リレーションエッジを描画し、
   検索 / タブ / ズームを制御します。

対応する多重度の表記: `OneToMany`、`ManyToOne`、`OneToOne`、`ManyToMany`、
比率文字列（`1:N`、`N:1`、`N:N`）、および FORMAT 16 以上の
`RelationType1/2` 数値コード（`3` = 鳥足側）。
不明・省略時は A5:ER の慣習である **1:N（Entity2 側が FK）** にフォールバックします。

## 制限事項

- ビューアは**読み取り専用**です — `.a5er` ファイルの編集・書き戻しは行いません。
- カードのレイアウトは A5:SQL Mk-2 エディタの近似です（同じ座標、実測テキスト幅）。ピクセルパーフェクトな再現ではありません。
- `Manager` / `Entity` / `Relation` / `Note` 以外のセクションは無視され、生成ファイルのフッターに一覧表示されるだけです（`skipped:`）。
- 物理ストレージ定義（表領域やインデックスなど）は描画されません。

## 開発

```console
$ git clone https://github.com/OWNER/a5er2html.git && cd a5er2html
$ python3 -m unittest discover -s tests -v
```

フィクスチャベースのテストワークフローは [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。

## ライセンス

[MIT](LICENSE)。本プロジェクトは A5:SQL Mk-2 およびその作者とは無関係です。
プレーンテキスト形式の `.a5er` ファイルを読み込むだけです。
