<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Notably in this repo: the `middleware` file convention is deprecated and renamed to `proxy` (`src/proxy.ts`, exporting `proxy()`).
<!-- END:nextjs-agent-rules -->

# このアプリ固有の決まりごと

- **管理者専用**。ログインはポータル SSO のみ（`/api/sso`）。ページ・Server Action の入口では必ず
  `requireAdminSession()` を通し、役割は JWT ではなく DB から都度確認する。
- 画面から渡された値（ライン種別・理論値など）を信用しない。前工程の理由必須のような業務ルールと理論値は、
  サーバー側で DB のマスタを引き直して判定・再計算する（`src/lib/actions.ts` の `saveReportAction`）。
- マスタの編集系 Server Action は `requireMasterEditor()` を通す（管理者かつ、生産管理部＝
  `MASTER_EDIT_DEPARTMENTS` またはポータル管理権限あり）。部署・管理権限はポータル SSO 由来の値を
  DB に持ち、判定は毎回 DB から引き直す。
- スキーマは `src/lib/schema.ts` の `ensureSchema()` に冪等な DDL として足す。マイグレーションファイルは持たない。
  **DDL を足したら `SCHEMA_VERSION` を必ず +1 する**（版数が上がらないと既存DBに DDL が流れない）。
- 日付・時刻の表示は JST 固定（`src/lib/format.ts`）。DB には `date` / `time` で持つ。
- 実績は「その時刻までの累計」で記録する。合計ではなく**最後の報告値**を使うこと（集計クエリ参照）。
- 利用者の区別はすべてポータルのログイン情報で行う（アプリ側の利用者マスタは持たない）。
  入力できる工場は、ポータル連携の所属（工場名・部署名）とマスタの工場名の一致で絞る（`getUserScope`。
  生産管理部・ポータル管理者は絞らない）。
  画面の絞り込みだけでなく、`saveReportAction` でも `isLineInScope` で必ず検証する。
- 残業の承認ワークフロー：**承認が要るのは翌日回し(defer) だけ**（生産管理部＝`canEditMaster` が許可）。
  実施(do) は承認不要で、生産管理部へ報告として届く（`approval_status` は NULL）。
  権限判定は `approveReportAction` に集約。報告を上書きすると許可は pending に戻る。
  翌日回しの許可画面では `DelayVisual` で遅れの理由（理由区分・理由の本文）を主役に見せる。
  申請時と結果（許可・差し戻し）は LINE WORKS へ通知する（`src/lib/approvalNotify.ts`）。
  宛先は生産管理部・申請者に加えて**対象工場のメンバー**（`listFactoryMemberLoginIds`）。
  通知の失敗で申請・許可を失敗させないこと。
- 入力を促す定期通知は `op_reminders` ＋ `/api/cron/reminders`（Vercel Cron 15分ごと）。
  **対象（工場全体／工場×ライン）ごとに1行**で、時刻は `remind_times`（`time[]`）に複数持つ。
  マスタ設定の画面も工場・ラインマスターと同じ「工場ごとの表」で、時刻は1つの欄にまとめて入力し、
  空にすればその行の通知をやめる（`saveRemindersAction`）。予定時刻を過ぎた分を45分以内で拾い、
  1回の実行で送るのは直近の1時刻だけ。`last_sent_date` / `last_sent_time` で二重送信を防ぐ。
  宛先が空なら対象工場のメンバー全員。
- 稼働日は `op_calendar`（`factory_id` が NULL なら全工場共通。工場の行があればそちらが優先）。
  休業日（`working = false`）は定期通知を送らず、臨時稼働（true）は曜日の設定に関係なく送る。
  曜日だけでは拾えない祝日・お盆・年末年始と休日出勤をここで持つ。
- 残業の申請内容は「人数 × 一人当たりの分」（`op_reports.overtime_headcount / overtime_minutes`）。
  対象者個人は記録しない（`op_overtime_members` は旧形式で、新規には書かない）。
- 理論値の計算は `src/lib/capacity.ts` に集約。休憩は実時刻で差し引き、稼働時間(H)で頭打ちにする。
