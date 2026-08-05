import { getSql } from "./neon";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DDL を実行するが、「既に存在する」系のエラーは無視する。
 * Postgres の CREATE TABLE/INDEX IF NOT EXISTS は同時実行に対して安全ではなく、
 * 複数リクエストが初回に同時に走ると pg_class のユニーク制約違反(23505/42P07/42710)で
 * 失敗しうる。冪等な初期化として、これらは握り潰す。
 */
async function safeDdl(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e: any) {
    const code = e?.code ?? e?.sourceError?.code;
    // 42P07: duplicate_table, 42710: duplicate_object, 23505: unique_violation(pg_catalog)
    if (code === "42P07" || code === "42710" || code === "23505") return;
    throw e;
  }
}

let schemaReady: Promise<void> | null = null;

/**
 * 進捗管理のテーブルを冪等に作成する。
 * - op_users             … 利用者（ポータルから連携された管理者）
 * - op_factories         … 工場マスタ
 * - op_lines             … ラインマスタ（ライン実力・稼働時間・始業・休憩）
 * - op_line_breaks       … 休憩時間帯（理論値の計算で差し引く）
 * - op_workers           … 旧グループ長マスタ（未使用。互換のため残置）
 * - op_daily_plans       … 日ごとの計画数・始業・投入人数
 * - op_reports           … 定期報告（進捗チェック／終業後）と残業の要否
 * - op_overtime_members  … 残業の対象者と時間
 *
 * 同一プロセス内の同時呼び出しは1回の実行に集約（共有プロミス）。失敗時は次回再試行できるよう解除。
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = buildSchema().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

async function buildSchema(): Promise<void> {
  const sql = getSql();

  // ===== 利用者 =====
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS op_users (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      login_id      text NOT NULL UNIQUE,
      name          text NOT NULL,
      email         text,
      -- ポータルの役割をそのまま持つ。'admin'（管理者）だけがこのアプリを使える
      role          text NOT NULL DEFAULT 'member',
      -- ポータルから連携された所属工場名（表示の初期値に使う）
      factory       text,
      -- ポータルの所属部署名。マスタを編集できる部署かどうかの判定に使う
      department    text,
      -- ポータルの管理権限（can_manage）。部署によらずマスタを編集できる
      portal_admin  boolean NOT NULL DEFAULT false,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    )`);
  // 既存DBにも列を足す（後から追加した列は ALTER で冪等に）
  await safeDdl(() => sql`ALTER TABLE op_users ADD COLUMN IF NOT EXISTS department text`);
  await safeDdl(
    () => sql`ALTER TABLE op_users ADD COLUMN IF NOT EXISTS portal_admin boolean NOT NULL DEFAULT false`
  );
  // 上長（残業申請の承認者）。利用者マスタで設定する
  await safeDdl(
    () =>
      sql`ALTER TABLE op_users ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES op_users(id) ON DELETE SET NULL`
  );

  // ===== マスタ =====
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS op_factories (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name       text NOT NULL UNIQUE,
      -- 社内の工場コード（02＝大口、0E＝清洲 など）
      code       text,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await safeDdl(() => sql`ALTER TABLE op_factories ADD COLUMN IF NOT EXISTS code text`);

  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS op_lines (
      id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      factory_id      uuid NOT NULL REFERENCES op_factories(id) ON DELETE CASCADE,
      -- ライン名（#1, #B など）
      name            text NOT NULL,
      -- 器種（そのラインで作るもの。例「片面ホーロー」）
      product         text,
      -- 'assembly'（組立ライン）| 'process'（前工程）
      line_type       text NOT NULL DEFAULT 'assembly',
      -- ライン実力（台/日・件/日）と、その実力を出せる稼働時間（H）
      capacity_per_day numeric(10,2) NOT NULL DEFAULT 0,
      work_hours       numeric(5,2) NOT NULL DEFAULT 8,
      -- 始業時刻。報告画面の既定値になる
      start_time       time NOT NULL DEFAULT '08:00',
      -- 標準の投入人数（一人当たり出来高の分母）
      headcount        numeric(6,1) NOT NULL DEFAULT 0,
      note             text,
      active           boolean NOT NULL DEFAULT true,
      sort_order       integer NOT NULL DEFAULT 0,
      created_at       timestamptz NOT NULL DEFAULT now(),
      UNIQUE (factory_id, name)
    )`);
  await safeDdl(() => sql`ALTER TABLE op_lines ADD COLUMN IF NOT EXISTS product text`);

  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS op_line_breaks (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      line_id    uuid NOT NULL REFERENCES op_lines(id) ON DELETE CASCADE,
      start_time time NOT NULL,
      end_time   time NOT NULL,
      UNIQUE (line_id, start_time)
    )`);

  // op_workers ＝ 旧グループ長マスタ。現在は未使用（入力範囲・承認者はポータルの
  // ログイン情報だけで決まる）。既存DBとの互換のため定義は残す
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS op_workers (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      factory_id  uuid NOT NULL REFERENCES op_factories(id) ON DELETE CASCADE,
      line_id     uuid REFERENCES op_lines(id) ON DELETE SET NULL,
      employee_no text NOT NULL,
      name        text NOT NULL,
      active      boolean NOT NULL DEFAULT true,
      created_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (factory_id, employee_no)
    )`);

  // ===== 日次計画 =====
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS op_daily_plans (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      line_id     uuid NOT NULL REFERENCES op_lines(id) ON DELETE CASCADE,
      plan_date   date NOT NULL,
      -- その日の計画数（組立＝台数 / 前工程＝製造指図の件数）
      planned_qty integer NOT NULL DEFAULT 0,
      start_time  time NOT NULL DEFAULT '08:00',
      headcount   numeric(6,1) NOT NULL DEFAULT 0,
      note        text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      UNIQUE (line_id, plan_date)
    )`);

  // ===== 定期報告（進捗チェック／終業後）=====
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS op_reports (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      line_id           uuid NOT NULL REFERENCES op_lines(id) ON DELETE CASCADE,
      plan_id           uuid REFERENCES op_daily_plans(id) ON DELETE SET NULL,
      report_date       date NOT NULL,
      -- 'checkpoint'（進捗チェック）| 'closing'（終業後）
      kind              text NOT NULL DEFAULT 'checkpoint',
      report_time       time NOT NULL,
      -- 理論値の計算に使った始業時刻と、その時点の計画数・理論値
      start_time        time NOT NULL DEFAULT '08:00',
      planned_qty       integer NOT NULL DEFAULT 0,
      theoretical_qty   integer NOT NULL DEFAULT 0,
      actual_qty        integer NOT NULL DEFAULT 0,
      -- 'ontrack'（順調）| 'delayed'（遅延）
      progress_status   text NOT NULL DEFAULT 'ontrack',
      -- 'do'（実施）| 'defer'（翌日回し）| 'none'（対象外）
      overtime_decision text NOT NULL DEFAULT 'none',
      -- 残業の申請内容（実施のとき）。人数 × 一人当たりの分
      overtime_headcount integer NOT NULL DEFAULT 0,
      overtime_minutes   integer NOT NULL DEFAULT 0,
      reason_code       text,
      reason            text,
      note              text,
      reported_by       uuid REFERENCES op_users(id) ON DELETE SET NULL,
      reported_at       timestamptz NOT NULL DEFAULT now(),
      -- 残業・翌日回しの承認ワークフロー。
      --   実施(do)      … 報告者の上長が承認（上長未設定なら生産管理部）→ 生産管理部へ届く
      --   翌日回し(defer)… 生産管理部が許可（approver_id は NULL＝生産管理部宛て）
      -- approval_status: 'pending' | 'approved' | 'rejected'（NULL＝承認対象外）
      approver_id       uuid REFERENCES op_users(id) ON DELETE SET NULL,
      approval_status   text,
      approval_by       uuid REFERENCES op_users(id) ON DELETE SET NULL,
      approval_at       timestamptz,
      approval_comment  text,
      UNIQUE (line_id, report_date, report_time)
    )`);
  // 既存DBにも承認列を足す（後から追加した列は ALTER で冪等に）
  await safeDdl(
    () =>
      sql`ALTER TABLE op_reports ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES op_users(id) ON DELETE SET NULL`
  );
  await safeDdl(() => sql`ALTER TABLE op_reports ADD COLUMN IF NOT EXISTS approval_status text`);
  await safeDdl(
    () =>
      sql`ALTER TABLE op_reports ADD COLUMN IF NOT EXISTS approval_by uuid REFERENCES op_users(id) ON DELETE SET NULL`
  );
  await safeDdl(() => sql`ALTER TABLE op_reports ADD COLUMN IF NOT EXISTS approval_at timestamptz`);
  await safeDdl(() => sql`ALTER TABLE op_reports ADD COLUMN IF NOT EXISTS approval_comment text`);
  await safeDdl(
    () =>
      sql`ALTER TABLE op_reports ADD COLUMN IF NOT EXISTS overtime_headcount integer NOT NULL DEFAULT 0`
  );
  await safeDdl(
    () =>
      sql`ALTER TABLE op_reports ADD COLUMN IF NOT EXISTS overtime_minutes integer NOT NULL DEFAULT 0`
  );
  // 旧形式（対象者ごとの記録 op_overtime_members）からの引き継ぎ。
  // 人数×時間に未設定（0）の実施報告だけを、人数=件数・時間=平均で埋める（冪等）。
  await safeDdl(() => sql`
    UPDATE op_reports r
    SET overtime_headcount = s.heads, overtime_minutes = s.avg_minutes
    FROM (
      SELECT report_id, COUNT(*)::int AS heads, ROUND(AVG(minutes))::int AS avg_minutes
      FROM op_overtime_members GROUP BY report_id
    ) s
    WHERE s.report_id = r.id AND r.overtime_headcount = 0 AND r.overtime_decision = 'do'`);

  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS op_overtime_members (
      id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      report_id uuid NOT NULL REFERENCES op_reports(id) ON DELETE CASCADE,
      worker_id uuid NOT NULL REFERENCES op_workers(id) ON DELETE RESTRICT,
      minutes   integer NOT NULL DEFAULT 0,
      UNIQUE (report_id, worker_id)
    )`);

  // ===== 索引（期間集計・日次表示で使う）=====
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS op_plans_date_idx ON op_daily_plans (plan_date)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS op_reports_date_idx ON op_reports (report_date)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS op_reports_line_date_idx ON op_reports (line_id, report_date)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS op_ot_members_report_idx ON op_overtime_members (report_id)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS op_workers_factory_idx ON op_workers (factory_id)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS op_line_breaks_line_idx ON op_line_breaks (line_id)`);
  // 承認待ち一覧用（承認待ちは常に少数なので部分索引にする）
  await safeDdl(
    () =>
      sql`CREATE INDEX IF NOT EXISTS op_reports_pending_idx ON op_reports (approval_status) WHERE approval_status = 'pending'`
  );
  // ライン絞り込み用（ログインIDと作業者の社員番号を突き合わせる）
  await safeDdl(
    () => sql`CREATE INDEX IF NOT EXISTS op_workers_employee_idx ON op_workers (employee_no)`
  );
}
