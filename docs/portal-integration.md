# ポータル（pf-portal）連携メモ

PF進捗管理を PFシリーズの1アプリとして組み込むために必要な設定と、ポータル側に入れてもらう変更。

## アプリキー

| 項目 | 値 |
| --- | --- |
| アプリキー | `operation` |
| 表示名 | PF進捗管理 |
| 想定URL | `https://operation.pf-paloma.co.jp` |

## このアプリ側の環境変数（Vercel）

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | Neon Postgres（このアプリ専用DB） |
| `NEXTAUTH_SECRET` | next-auth のセッション署名鍵 |
| `NEXTAUTH_URL` | `https://operation.pf-paloma.co.jp` |
| `PF_PROVISION_KEY` | ポータルと共有する鍵。SSO トークン検証と `/api/provision` の認証に使う。**ポータル側と同じ値** |
| `MASTER_EDIT_PIN` | マスタ（ライン実力・稼働時間など）の編集ロックを外す PIN。未設定ならロック無効 |

## ポータル側に必要な変更（このリポジトリの変更ではない）

1. `lib/appUrls.js` の `APP_BASE_URLS` に追加

   ```js
   operation: "https://operation.pf-paloma.co.jp",
   ```

2. `lib/db.js` の `ALL_APP_KEYS`（部署に割り当てられるアプリ一覧）に `operation` を追加

3. `lib/provision.js` の `PROVISION_APP_KEYS` に `operation` を追加
   （アカウント連携を行う場合。行わなくても SSO 時に自動でユーザーが作られる）

4. ポータルのアプリ一覧に「進捗管理」のカードとアイコン（`icons/operation.png`）を追加

   アイコンはこのリポジトリの `public/icon-192.png` をそのままコピーする
   （他アプリと同じ 192×192・全面ベタの PNG。角丸はポータル側の CSS が付ける）。

5. 利用させたい部署の `apps` に `operation` を含める

> 管理者専用アプリのため、`apps` に `operation` を持つ部署のうち、
> **役割が `admin` のユーザーだけが実際に入れる**。`member` は SSO 時に弾かれ、
> ログイン画面で「管理者専用」と案内される。

## SSO の流れ

```
ポータル /api/user?launch=operation
  → 署名トークン（loginId / name / role / app / exp、TTL 60秒、HMAC-SHA256 = PF_PROVISION_KEY）
  → 302 https://operation.pf-paloma.co.jp/api/sso?token=...
      ├ 署名・app・期限を検証
      ├ op_users に upsert（氏名・役割・所属工場はポータルを正として毎回上書き）
      ├ role !== 'admin' なら /login?error=forbidden
      └ next-auth の JWT を発行して "/" へ
```

トークンに `factory`（所属工場名）が含まれていれば取り込む。無くても動作する（表示の初期値に使うだけ）。

## プロビジョニング API

`POST /api/provision`

```json
{
  "key": "<PF_PROVISION_KEY>",
  "users": [
    { "loginId": "12345", "name": "山田 太郎", "email": "…", "role": "admin", "factory": "本社工場" }
  ]
}
```

レスポンス

```json
{ "results": [{ "loginId": "12345", "status": "created", "passwordSet": true }] }
```

このアプリは SSO 専用でアプリ側パスワードを持たないため、`inviteUrl` は返さず `passwordSet` は常に `true`
（＝ポータル側の「パスワード未設定」表示にならない）。`role: "member"` のユーザーも台帳としては登録するが、
SSO でログインはできない。

## データベース

テーブルは初回アクセス時に `src/lib/schema.ts` の `ensureSchema()` が冪等に作成する。

| テーブル | 内容 |
| --- | --- |
| `op_users` | 利用者（ポータル連携） |
| `op_factories` | 工場マスタ |
| `op_lines` | ラインマスタ（`line_type` = `assembly` / `process`、ライン実力・稼働時間・始業） |
| `op_line_breaks` | 休憩時間帯（理論値の計算で差し引く） |
| `op_workers` | 作業者（残業の対象者） |
| `op_daily_plans` | 日ごとの計画数・始業・投入人数 |
| `op_reports` | 定期報告（進捗チェック／終業後、理論値・実績・生産進捗・残業の要否） |
| `op_overtime_members` | 残業の対象者と時間（分） |
