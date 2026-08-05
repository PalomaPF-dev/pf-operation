# ポータル（pf-portal）連携メモ

PF進捗管理を PFシリーズの1アプリとして組み込むために必要な設定と、ポータル側に入れてもらう変更。

## アプリキー

| 項目 | 値 |
| --- | --- |
| アプリキー | `operation` |
| 表示名 | PF進捗管理 |
| 想定URL | `https://operation.paloma-pf.com` |

## このアプリ側の環境変数（Vercel）

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | Neon Postgres（このアプリ専用DB） |
| `NEXTAUTH_SECRET` | next-auth のセッション署名鍵 |
| `NEXTAUTH_URL` | `https://operation.paloma-pf.com` |
| `PF_PROVISION_KEY` | ポータルと共有する鍵。SSO トークン検証と `/api/provision` の認証に使う。**ポータル側と同じ値** |
| `MASTER_EDIT_DEPARTMENTS` | マスタを編集できる部署（カンマ区切り）。未設定なら `生産管理部`。ポータル管理者は部署によらず編集できる |

## ポータル側に必要な変更（このリポジトリの変更ではない）

1. `lib/appUrls.js` の `APP_BASE_URLS` に追加

   ```js
   operation: "https://operation.paloma-pf.com",
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
  → 署名トークン（loginId / name / role / department / canManage /
     approverLoginId / approverName / app / exp、TTL 60秒、HMAC-SHA256 = PF_PROVISION_KEY）
  → 302 https://operation.paloma-pf.com/api/sso?token=...
      ├ 署名・app・期限を検証
      ├ op_users に upsert（氏名・役割・所属工場・所属部署はポータルを正として毎回上書き）
      ├ role !== 'admin' なら /login?error=forbidden
      └ next-auth の JWT を発行して "/" へ
```

トークンに `factory`（所属工場名）が含まれていれば取り込む。無くても動作する（表示の初期値に使うだけ）。

`department`（所属部署名）と `canManage`（ポータル管理権限）は**マスタ編集の可否**に使う。

| 条件 | マスタ |
| --- | --- |
| `canManage: true`（ポータル管理者） | 部署によらず**編集できる** |
| 所属部署が `MASTER_EDIT_DEPARTMENTS`（既定「生産管理部」）に含まれる | 編集できる |
| それ以外の管理者 | 閲覧のみ |

ポータル側は `api/user.js` の launch トークンに `department: profile.departmentName` と
`canManage: profile.canManage === true` を含めること。どちらも送られてこないユーザーは閲覧のみになる。
`canManage` は SSO で受け取った値を `op_users.portal_admin` に保持し、判定は毎回 DB から引き直す。

`approverLoginId` / `approverName`（ポータルの承認者＝上司設定）は**残業申請の承認ルート**に使う。
申請者（管理者）→ 承認者 → 生産管理部の順で、SSO ログインのたびにポータルを正として
`op_users.approver_id` へ同期する（未ログインの上長はスタブ行を作って参照する）。
プロビジョニング API の `approverLoginId` でも同じ同期が走る。

## プロビジョニング API

`POST /api/provision`

```json
{
  "key": "<PF_PROVISION_KEY>",
  "users": [
    { "loginId": "12345", "name": "山田 太郎", "email": "…", "role": "admin",
      "factory": "本社工場", "department": "生産管理部" }
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
| `op_workers` | グループ長（ラインの残業有無の申請者。社員番号がログインIDと一致すると入力画面が担当ラインに絞られる） |
| `op_daily_plans` | 日ごとの計画数・始業・投入人数 |
| `op_reports` | 定期報告（進捗チェック／終業後、理論値・実績・生産進捗・残業の要否・人数×時間・承認状態） |
| `op_overtime_members` | 旧形式（対象者ごとの記録）。新規には書かない |
