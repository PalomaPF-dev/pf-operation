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
- 日付・時刻の表示は JST 固定（`src/lib/format.ts`）。DB には `date` / `time` で持つ。
- 実績は「その時刻までの累計」で記録する。合計ではなく**最後の報告値**を使うこと（集計クエリ参照）。
- 入力できるラインは、ログインID＝グループ長マスタ（`op_workers`＝ラインの残業申請者）の
  社員番号の一致で絞る（`getUserScope`）。
  画面の絞り込みだけでなく、`saveReportAction` でも `isLineInScope` で必ず検証する。
- 残業の承認ワークフロー：実施(do)＝報告者の上長（`op_users.approver_id`、未設定なら生産管理部）が承認し、
  承認済みが生産管理部へ届く。翌日回し(defer)＝生産管理部（`canEditMaster`）が許可する。
  承認の権限判定は `approveReportAction` に集約。報告を上書きすると承認は pending に戻る。
- 残業の申請内容は「人数 × 一人当たりの分」（`op_reports.overtime_headcount / overtime_minutes`）。
  対象者個人は記録しない（`op_overtime_members` は旧形式で、新規には書かない）。
- 理論値の計算は `src/lib/capacity.ts` に集約。休憩は実時刻で差し引き、稼働時間(H)で頭打ちにする。
