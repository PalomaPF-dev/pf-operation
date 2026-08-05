import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import { formatTime, toDateString } from "./format";
import { plannedManHoursOf } from "./capacity";
import FACTORY_LINES from "@/data/factoryLines.json";
import type {
  ApprovalStatus,
  BreakSpan,
  DailyPlan,
  Factory,
  Line,
  LineType,
  OvertimeDecision,
  ProgressStatus,
  ReasonCode,
  Report,
  ReportKind,
  SummaryRow,
  Worker,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Postgres の numeric は文字列で返るため数値に寄せる。 */
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const dateStr = (v: unknown): string =>
  v instanceof Date ? toDateString(v) : String(v ?? "").slice(0, 10);

const tsStr = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

const toLineType = (v: unknown): LineType => (v === "process" ? "process" : "assembly");

// ===== 工場マスタ =====

export async function listFactories(): Promise<Factory[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, code, sort_order FROM op_factories ORDER BY sort_order, name`;
  return rows.map((r: any) => ({
    id: r.id as string,
    name: r.name as string,
    code: (r.code as string | null) ?? null,
    sortOrder: num(r.sort_order),
  }));
}

export async function createFactory(
  name: string,
  code: string | null,
  sortOrder: number
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`INSERT INTO op_factories (name, code, sort_order) VALUES (${name}, ${code}, ${sortOrder})`;
}

export async function updateFactory(
  id: string,
  name: string,
  code: string | null,
  sortOrder: number
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE op_factories SET name = ${name}, code = ${code}, sort_order = ${sortOrder}
    WHERE id = ${id}`;
}

export async function deleteFactory(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM op_factories WHERE id = ${id}`;
}

// ===== ラインマスタ =====

function mapLine(r: any): Line {
  const spans = (r.breaks as string[] | null) ?? [];
  const breaks: BreakSpan[] = spans
    .map((s) => {
      const [start, end] = String(s).split("|");
      return { start: formatTime(start), end: formatTime(end) };
    })
    .filter((b) => b.start && b.end);
  return {
    id: r.id as string,
    factoryId: r.factory_id as string,
    factoryName: r.factory_name as string,
    name: r.name as string,
    product: (r.product as string | null) ?? null,
    lineType: toLineType(r.line_type),
    capacityPerDay: num(r.capacity_per_day),
    workHours: num(r.work_hours),
    startTime: formatTime(r.start_time as string),
    breaks,
    headcount: num(r.headcount),
    note: (r.note as string | null) ?? null,
    active: r.active !== false,
    sortOrder: num(r.sort_order),
  };
}

const LINE_SELECT = `
  SELECT l.id, l.factory_id, f.name AS factory_name, f.sort_order AS factory_sort,
         l.name, l.product, l.line_type, l.capacity_per_day, l.work_hours, l.start_time,
         l.headcount, l.note, l.active, l.sort_order,
         COALESCE(
           (SELECT array_agg(b.start_time::text || '|' || b.end_time::text ORDER BY b.start_time)
            FROM op_line_breaks b WHERE b.line_id = l.id),
           ARRAY[]::text[]
         ) AS breaks
  FROM op_lines l
  JOIN op_factories f ON f.id = l.factory_id`;

/** ラインを休憩時間帯つきで一覧する。activeOnly のとき停止中のラインを除く。 */
export async function listLines(
  opts: { factoryId?: string | null; activeOnly?: boolean } = {}
): Promise<Line[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(
    `${LINE_SELECT}
     WHERE ($1::uuid IS NULL OR l.factory_id = $1)
       AND ($2::boolean = false OR l.active = true)
     ORDER BY f.sort_order, f.name, l.sort_order, l.name`,
    [opts.factoryId ?? null, opts.activeOnly === true]
  );
  return rows.map(mapLine);
}

export async function getLine(id: string): Promise<Line | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(`${LINE_SELECT} WHERE l.id = $1 LIMIT 1`, [id]);
  return rows[0] ? mapLine(rows[0]) : null;
}

export interface LineInput {
  factoryId: string;
  name: string;
  product: string | null;
  lineType: LineType;
  capacityPerDay: number;
  workHours: number;
  startTime: string;
  breaks: BreakSpan[];
  headcount: number;
  note: string | null;
  active: boolean;
  sortOrder: number;
}

export async function createLine(input: LineInput): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO op_lines
      (factory_id, name, product, line_type, capacity_per_day, work_hours, start_time,
       headcount, note, active, sort_order)
    VALUES
      (${input.factoryId}, ${input.name}, ${input.product}, ${input.lineType}, ${input.capacityPerDay},
       ${input.workHours}, ${input.startTime}, ${input.headcount}, ${input.note},
       ${input.active}, ${input.sortOrder})
    RETURNING id`;
  const id = rows[0].id as string;
  await replaceBreaks(id, input.breaks);
  return id;
}

export async function updateLine(id: string, input: LineInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE op_lines
    SET factory_id = ${input.factoryId}, name = ${input.name}, product = ${input.product},
        line_type = ${input.lineType},
        capacity_per_day = ${input.capacityPerDay}, work_hours = ${input.workHours},
        start_time = ${input.startTime}, headcount = ${input.headcount},
        note = ${input.note}, active = ${input.active}, sort_order = ${input.sortOrder}
    WHERE id = ${id}`;
  await replaceBreaks(id, input.breaks);
}

/** マスタ表からの1行更新（器種・現状人員・ライン実力・稼働時間・備考）。 */
export async function updateLineRow(
  id: string,
  input: {
    product: string | null;
    headcount: number;
    capacityPerDay: number;
    workHours: number;
    note: string | null;
  }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE op_lines
    SET product = ${input.product}, headcount = ${input.headcount},
        capacity_per_day = ${input.capacityPerDay}, work_hours = ${input.workHours},
        note = ${input.note}
    WHERE id = ${id}`;
}

export async function deleteLine(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM op_lines WHERE id = ${id}`;
}

async function replaceBreaks(lineId: string, breaks: BreakSpan[]): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM op_line_breaks WHERE line_id = ${lineId}`;
  if (breaks.length === 0) return;
  const starts = breaks.map((b) => b.start);
  const ends = breaks.map((b) => b.end);
  await sql`
    INSERT INTO op_line_breaks (line_id, start_time, end_time)
    SELECT ${lineId}::uuid, x.s::time, x.e::time
    FROM unnest(${starts}::text[], ${ends}::text[]) AS x(s, e)
    ON CONFLICT (line_id, start_time) DO UPDATE SET end_time = EXCLUDED.end_time`;
}

// ===== 受領マスタの取り込み =====

/**
 * 生産管理部から受領した「工場・ラインマスター」を取り込む（冪等）。
 *
 * 工場は名前、ラインは（工場・ライン名）で突き合わせ、既にあれば上書きする。
 * 何度実行しても同じ状態になる。手で直した器種・人員も受領値に戻る点に注意。
 * 種別（組立/前工程）と稼働状態は画面で調整するものなので、既存行では変更しない。
 */
export async function importFactoryLines(): Promise<{ factories: number; lines: number }> {
  await ensureSchema();
  const sql = getSql();
  const breaks: BreakSpan[] = FACTORY_LINES.breaks.map(([start, end]) => ({ start, end }));

  let factoryOrder = 0;
  let lineCount = 0;
  for (const f of FACTORY_LINES.factories) {
    factoryOrder += 10;
    const factoryRows = await sql`
      INSERT INTO op_factories (name, code, sort_order)
      VALUES (${f.name}, ${f.code}, ${factoryOrder})
      ON CONFLICT (name) DO UPDATE SET
        code = EXCLUDED.code, sort_order = EXCLUDED.sort_order
      RETURNING id`;
    const factoryId = factoryRows[0].id as string;

    let order = 0;
    for (const line of f.lines) {
      order += 10;
      const lineRows = await sql`
        INSERT INTO op_lines
          (factory_id, name, product, line_type, capacity_per_day, work_hours, start_time,
           headcount, note, active, sort_order)
        VALUES
          (${factoryId}, ${line.name}, ${line.product}, 'assembly', ${line.capacityPerDay},
           ${line.workHours}, ${FACTORY_LINES.startTime}, ${line.headcount}, ${line.note},
           true, ${order})
        ON CONFLICT (factory_id, name) DO UPDATE SET
          product          = EXCLUDED.product,
          capacity_per_day = EXCLUDED.capacity_per_day,
          work_hours       = EXCLUDED.work_hours,
          headcount        = EXCLUDED.headcount,
          note             = EXCLUDED.note,
          sort_order       = EXCLUDED.sort_order
        RETURNING id`;
      await replaceBreaks(lineRows[0].id as string, breaks);
      lineCount += 1;
    }
  }
  return { factories: FACTORY_LINES.factories.length, lines: lineCount };
}

// ===== 入力範囲（担当ライン）の絞り込み =====

/**
 * ログインした人の入力範囲。
 * null は無制限（グループ長マスタに載っていない人＝生産管理部・本部の管理者など）。
 */
export interface UserScope {
  /** 担当ライン。グループ長マスタでラインが設定されている行 */
  lineIds: string[];
  /** ライン未設定で登録されている工場（その工場の全ラインに入力できる） */
  factoryIds: string[];
}

/**
 * ログインした人の入力範囲を出す。優先順位：
 * 1. グループ長マスタに登録があれば、その担当ライン（ライン未設定の行は工場全体）。
 * 2. なければ、ポータル連携の所属（工場名・部署名）がマスタの工場名と一致すれば、その工場に固定。
 *    ポータルでは「大口工場」のような工場が部署として登録されているため、部署名も突き合わせる。
 * 3. どちらも無ければ null（全工場に入力できる）。
 * 生産管理部・ポータル管理者（canEditMaster）は 2 を適用しない（全工場を横断して入力できる）。
 */
export async function getUserScope(user: {
  loginId: string;
  factory: string | null;
  department: string | null;
  canEditMaster: boolean;
}): Promise<UserScope | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT factory_id, line_id FROM op_workers
    WHERE employee_no = ${user.loginId}`;
  if (rows.length > 0) {
    const lineIds: string[] = [];
    const factoryIds: string[] = [];
    for (const r of rows as any[]) {
      if (r.line_id) lineIds.push(r.line_id as string);
      else factoryIds.push(r.factory_id as string);
    }
    return { lineIds, factoryIds };
  }
  // 所属での絞り込み（グループ長登録が無い工場の管理者向け）。
  // 工場名・部署名のどちらかがマスタの工場名と一致すれば、その工場だけにする
  if (!user.canEditMaster) {
    const names = [user.factory, user.department].filter((v): v is string => !!v);
    if (names.length > 0) {
      const f = await sql`SELECT id FROM op_factories WHERE name = ANY(${names}::text[])`;
      if (f.length > 0) {
        return { lineIds: [], factoryIds: (f as any[]).map((r) => r.id as string) };
      }
    }
  }
  return null;
}

/** そのラインに入力できるか。scope が null なら常に true。 */
export function isLineInScope(
  scope: UserScope | null,
  line: { id: string; factoryId: string }
): boolean {
  if (!scope) return true;
  return scope.lineIds.includes(line.id) || scope.factoryIds.includes(line.factoryId);
}

// ===== 利用者（上長の設定） =====

export interface AppUserRow {
  id: string;
  loginId: string;
  name: string;
  role: string;
  factory: string | null;
  department: string | null;
  portalAdmin: boolean;
  approverId: string | null;
  approverName: string | null;
}

/** 利用者の一覧（上長の設定画面用）。 */
export async function listAppUsers(): Promise<AppUserRow[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT u.id, u.login_id, u.name, u.role, u.factory, u.department, u.portal_admin,
           u.approver_id, a.name AS approver_name
    FROM op_users u
    LEFT JOIN op_users a ON a.id = u.approver_id
    ORDER BY u.login_id`;
  return (rows as any[]).map((r) => ({
    id: r.id as string,
    loginId: r.login_id as string,
    name: r.name as string,
    role: String(r.role ?? "member"),
    factory: (r.factory as string | null) ?? null,
    department: (r.department as string | null) ?? null,
    portalAdmin: r.portal_admin === true,
    approverId: (r.approver_id as string | null) ?? null,
    approverName: (r.approver_name as string | null) ?? null,
  }));
}

/** 上長（残業申請の承認者）を設定する。null で解除（申請は生産管理部宛てになる）。 */
export async function setUserApprover(userId: string, approverId: string | null): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE op_users SET approver_id = ${approverId}, updated_at = now()
    WHERE id = ${userId}`;
}

// ===== グループ長マスタ（op_workers。ラインの残業有無の申請者） =====

export async function listWorkers(
  opts: { factoryId?: string | null } = {}
): Promise<Worker[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(
    `SELECT w.id, w.factory_id, f.name AS factory_name, w.line_id, l.name AS line_name,
            w.employee_no, w.name
     FROM op_workers w
     JOIN op_factories f ON f.id = w.factory_id
     LEFT JOIN op_lines l ON l.id = w.line_id
     WHERE ($1::uuid IS NULL OR w.factory_id = $1)
     ORDER BY f.sort_order, f.name, w.employee_no`,
    [opts.factoryId ?? null]
  );
  return (rows as any[]).map((r) => ({
    id: r.id as string,
    factoryId: r.factory_id as string,
    factoryName: r.factory_name as string,
    lineId: (r.line_id as string | null) ?? null,
    lineName: (r.line_name as string | null) ?? null,
    employeeNo: r.employee_no as string,
    name: r.name as string,
  }));
}

export interface WorkerInput {
  factoryId: string;
  lineId: string | null;
  employeeNo: string;
  name: string;
}

export async function createWorker(input: WorkerInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO op_workers (factory_id, line_id, employee_no, name)
    VALUES (${input.factoryId}, ${input.lineId}, ${input.employeeNo}, ${input.name})`;
}

export async function updateWorker(id: string, input: WorkerInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    UPDATE op_workers
    SET factory_id = ${input.factoryId}, line_id = ${input.lineId},
        employee_no = ${input.employeeNo}, name = ${input.name}
    WHERE id = ${id}`;
}

export async function deleteWorker(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM op_workers WHERE id = ${id}`;
}

// ===== 日次計画 =====

function mapPlan(r: any): DailyPlan {
  return {
    id: r.id as string,
    lineId: r.line_id as string,
    planDate: dateStr(r.plan_date),
    plannedQty: num(r.planned_qty),
    startTime: formatTime(r.start_time as string),
    headcount: num(r.headcount),
    note: (r.note as string | null) ?? null,
  };
}

export async function getPlan(lineId: string, planDate: string): Promise<DailyPlan | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, line_id, plan_date, planned_qty, start_time, headcount, note
    FROM op_daily_plans WHERE line_id = ${lineId} AND plan_date = ${planDate} LIMIT 1`;
  return rows[0] ? mapPlan(rows[0]) : null;
}

export async function listPlansByDate(
  planDate: string,
  factoryId: string | null = null
): Promise<DailyPlan[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(
    `SELECT p.id, p.line_id, p.plan_date, p.planned_qty, p.start_time, p.headcount, p.note
     FROM op_daily_plans p
     JOIN op_lines l ON l.id = p.line_id
     WHERE p.plan_date = $1 AND ($2::uuid IS NULL OR l.factory_id = $2)`,
    [planDate, factoryId]
  );
  return (rows as any[]).map(mapPlan);
}

export interface PlanInput {
  plannedQty: number;
  startTime: string;
  headcount: number;
  note: string | null;
}

/** 報告のたびに、その日の計画数・始業・投入人数を最新の入力で上書きする。 */
export async function upsertPlan(
  lineId: string,
  planDate: string,
  input: PlanInput
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO op_daily_plans (line_id, plan_date, planned_qty, start_time, headcount, note)
    VALUES (${lineId}, ${planDate}, ${input.plannedQty}, ${input.startTime}, ${input.headcount}, ${input.note})
    ON CONFLICT (line_id, plan_date) DO UPDATE SET
      planned_qty = EXCLUDED.planned_qty,
      start_time  = EXCLUDED.start_time,
      headcount   = EXCLUDED.headcount,
      note        = COALESCE(EXCLUDED.note, op_daily_plans.note),
      updated_at  = now()
    RETURNING id`;
  return rows[0].id as string;
}

// ===== 定期報告 =====

function mapReport(r: any): Report {
  const overtimeHeadcount = num(r.overtime_headcount);
  const overtimeMinutesPerPerson = num(r.overtime_minutes);
  return {
    id: r.id as string,
    lineId: r.line_id as string,
    lineName: r.line_name as string,
    lineType: toLineType(r.line_type),
    factoryId: r.factory_id as string,
    factoryName: r.factory_name as string,
    reportDate: dateStr(r.report_date),
    kind: (r.kind as ReportKind) ?? "checkpoint",
    reportTime: formatTime(r.report_time as string),
    startTime: formatTime(r.start_time as string),
    plannedQty: num(r.planned_qty),
    theoreticalQty: num(r.theoretical_qty),
    actualQty: num(r.actual_qty),
    progressStatus: (r.progress_status as ProgressStatus) ?? "ontrack",
    overtimeDecision: (r.overtime_decision as OvertimeDecision) ?? "none",
    reasonCode: (r.reason_code as ReasonCode | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    reportedById: (r.reported_by as string | null) ?? null,
    reportedByName: (r.reported_by_name as string | null) ?? null,
    reportedAt: tsStr(r.reported_at),
    approverId: (r.approver_id as string | null) ?? null,
    approverName: (r.approver_name as string | null) ?? null,
    approvalStatus: (r.approval_status as ApprovalStatus | null) ?? null,
    approvalByName: (r.approval_by_name as string | null) ?? null,
    approvalAt: tsStr(r.approval_at),
    approvalComment: (r.approval_comment as string | null) ?? null,
    overtimeHeadcount,
    overtimeMinutesPerPerson,
    overtimeManMinutes: overtimeHeadcount * overtimeMinutesPerPerson,
  };
}

const REPORT_SELECT = `
  SELECT r.id, r.line_id, l.name AS line_name, l.line_type,
         l.factory_id, f.name AS factory_name,
         r.report_date, r.kind, r.report_time, r.start_time,
         r.planned_qty, r.theoretical_qty, r.actual_qty,
         r.progress_status, r.overtime_decision, r.reason_code, r.reason, r.note,
         r.reported_by, r.reported_at, u.name AS reported_by_name,
         r.approver_id, ap.name AS approver_name,
         r.approval_status, ab.name AS approval_by_name, r.approval_at, r.approval_comment,
         r.overtime_headcount, r.overtime_minutes
  FROM op_reports r
  JOIN op_lines l ON l.id = r.line_id
  JOIN op_factories f ON f.id = l.factory_id
  LEFT JOIN op_users u ON u.id = r.reported_by
  LEFT JOIN op_users ap ON ap.id = r.approver_id
  LEFT JOIN op_users ab ON ab.id = r.approval_by`;

export interface ReportFilter {
  dateFrom?: string | null;
  dateTo?: string | null;
  factoryId?: string | null;
  lineId?: string | null;
  /** 残業の要否で絞る */
  overtimeDecision?: OvertimeDecision | null;
  /** 生産進捗で絞る */
  progressStatus?: ProgressStatus | null;
  /** 承認状態で絞る（'pending' | 'approved' | 'rejected'） */
  approvalStatus?: ApprovalStatus | null;
  limit?: number;
}

export async function listReports(filter: ReportFilter = {}): Promise<Report[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(
    `${REPORT_SELECT}
     WHERE ($1::date IS NULL OR r.report_date >= $1)
       AND ($2::date IS NULL OR r.report_date <= $2)
       AND ($3::uuid IS NULL OR l.factory_id = $3)
       AND ($4::uuid IS NULL OR r.line_id = $4)
       AND ($5::text IS NULL OR r.overtime_decision = $5)
       AND ($6::text IS NULL OR r.progress_status = $6)
       AND ($7::text IS NULL OR r.approval_status = $7)
     ORDER BY r.report_date DESC, f.sort_order, l.sort_order, r.report_time DESC
     LIMIT $8`,
    [
      filter.dateFrom ?? null,
      filter.dateTo ?? null,
      filter.factoryId ?? null,
      filter.lineId ?? null,
      filter.overtimeDecision ?? null,
      filter.progressStatus ?? null,
      filter.approvalStatus ?? null,
      Math.min(filter.limit ?? 300, 2000),
    ]
  );
  return (rows as any[]).map(mapReport);
}

export async function getReport(id: string): Promise<Report | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(`${REPORT_SELECT} WHERE r.id = $1 LIMIT 1`, [id]);
  return rows[0] ? mapReport(rows[0]) : null;
}

/** 指定日・指定ラインの報告（時刻の昇順）。 */
export async function listReportsOfDay(lineId: string, date: string): Promise<Report[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(
    `${REPORT_SELECT} WHERE r.line_id = $1 AND r.report_date = $2 ORDER BY r.report_time`,
    [lineId, date]
  );
  return (rows as any[]).map(mapReport);
}

/** 指定日の全ラインの最終報告（ダッシュボード用）。ラインIDをキーにした Map。 */
export async function latestReportsByDate(
  date: string,
  factoryId: string | null = null
): Promise<Map<string, Report>> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(
    `${REPORT_SELECT}
     WHERE r.report_date = $1
       AND ($2::uuid IS NULL OR l.factory_id = $2)
     ORDER BY r.line_id, r.report_time`,
    [date, factoryId]
  );
  const out = new Map<string, Report>();
  for (const r of rows as any[]) {
    const rep = mapReport(r);
    // 時刻の昇順なので、後から入れたものが最終報告になる
    out.set(rep.lineId, rep);
  }
  return out;
}

export interface ReportInput {
  lineId: string;
  planId: string | null;
  reportDate: string;
  kind: ReportKind;
  reportTime: string;
  startTime: string;
  plannedQty: number;
  theoreticalQty: number;
  actualQty: number;
  progressStatus: ProgressStatus;
  overtimeDecision: OvertimeDecision;
  reasonCode: ReasonCode | null;
  reason: string | null;
  note: string | null;
  /** 残業の申請内容（実施のとき）。人数 × 一人当たりの分 */
  overtimeHeadcount: number;
  overtimeMinutesPerPerson: number;
}

/**
 * 報告を登録する。同じライン・同じ日・同じ時刻の報告は上書きする
 * （打ち間違いを直したいときに、同じ時刻でもう一度出せば直る）。
 *
 * 承認ワークフローもここで開始する：
 * - 実施(do)      … 承認待ち。承認者は報告者の上長（未設定なら NULL＝生産管理部宛て）
 * - 翌日回し(defer)… 生産管理部の許可待ち（承認者 NULL）
 * - 対象外(none)   … ワークフローなし
 * 上書き時は承認状態もリセットされる（内容が変われば承認は取り直し）。
 */
export async function saveReport(
  input: ReportInput,
  userId: string,
  approverId: string | null
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const needsApproval = input.overtimeDecision === "do" || input.overtimeDecision === "defer";
  const approvalStatus = needsApproval ? "pending" : null;
  // 翌日回しは常に生産管理部宛て。実施は上長宛て（未設定なら生産管理部宛て）
  const routedApprover = input.overtimeDecision === "do" ? approverId : null;
  const otHeads = input.overtimeDecision === "do" ? input.overtimeHeadcount : 0;
  const otMinutes = input.overtimeDecision === "do" ? input.overtimeMinutesPerPerson : 0;
  const rows = await sql`
    INSERT INTO op_reports
      (line_id, plan_id, report_date, kind, report_time, start_time,
       planned_qty, theoretical_qty, actual_qty, progress_status, overtime_decision,
       overtime_headcount, overtime_minutes,
       reason_code, reason, note, reported_by, reported_at,
       approver_id, approval_status, approval_by, approval_at, approval_comment)
    VALUES
      (${input.lineId}, ${input.planId}, ${input.reportDate}, ${input.kind}, ${input.reportTime},
       ${input.startTime}, ${input.plannedQty}, ${input.theoreticalQty}, ${input.actualQty},
       ${input.progressStatus}, ${input.overtimeDecision}, ${otHeads}, ${otMinutes},
       ${input.reasonCode}, ${input.reason},
       ${input.note}, ${userId}, now(),
       ${routedApprover}, ${approvalStatus}, NULL, NULL, NULL)
    ON CONFLICT (line_id, report_date, report_time) DO UPDATE SET
      plan_id            = EXCLUDED.plan_id,
      kind               = EXCLUDED.kind,
      start_time         = EXCLUDED.start_time,
      planned_qty        = EXCLUDED.planned_qty,
      theoretical_qty    = EXCLUDED.theoretical_qty,
      actual_qty         = EXCLUDED.actual_qty,
      progress_status    = EXCLUDED.progress_status,
      overtime_decision  = EXCLUDED.overtime_decision,
      overtime_headcount = EXCLUDED.overtime_headcount,
      overtime_minutes   = EXCLUDED.overtime_minutes,
      reason_code        = EXCLUDED.reason_code,
      reason             = EXCLUDED.reason,
      note               = EXCLUDED.note,
      reported_by        = EXCLUDED.reported_by,
      reported_at        = now(),
      approver_id        = EXCLUDED.approver_id,
      approval_status    = EXCLUDED.approval_status,
      approval_by        = NULL,
      approval_at        = NULL,
      approval_comment   = NULL
    RETURNING id`;
  const id = rows[0].id as string;
  // 旧形式（対象者ごとの記録）が残っていれば、上書きに合わせて掃除する
  await sql`DELETE FROM op_overtime_members WHERE report_id = ${id}`;
  return id;
}

// ===== 承認ワークフロー =====

/**
 * 承認待ちの一覧。
 * - 自分宛て：実施(do) で承認者＝自分のもの
 * - 生産管理部（canEditMaster）：翌日回し(defer) と、上長未設定の実施(do)
 */
export async function listPendingApprovals(viewer: {
  userId: string;
  canEditMaster: boolean;
}): Promise<Report[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(
    `${REPORT_SELECT}
     WHERE r.approval_status = 'pending'
       AND (
         (r.overtime_decision = 'do' AND r.approver_id = $1)
         OR ($2 AND (r.overtime_decision = 'defer'
                     OR (r.overtime_decision = 'do' AND r.approver_id IS NULL)))
       )
     ORDER BY r.report_date, f.sort_order, l.sort_order, r.report_time`,
    [viewer.userId, viewer.canEditMaster]
  );
  return (rows as any[]).map(mapReport);
}

/** 自分が出した申請（実施・翌日回し）の直近一覧。承認状態の確認用。 */
export async function listMyOvertimeRequests(userId: string, limit = 20): Promise<Report[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql.query(
    `${REPORT_SELECT}
     WHERE r.reported_by = $1 AND r.overtime_decision IN ('do', 'defer')
     ORDER BY r.report_date DESC, r.report_time DESC
     LIMIT $2`,
    [userId, Math.min(limit, 100)]
  );
  return (rows as any[]).map(mapReport);
}

/**
 * 承認／差し戻しを記録する。権限判定は呼び出し側（Server Action）で行う。
 * pending のときだけ更新する（二重承認・追い越しを防ぐ）。戻り値は更新できたか。
 */
export async function applyApproval(
  reportId: string,
  status: Extract<ApprovalStatus, "approved" | "rejected">,
  byUserId: string,
  comment: string | null
): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE op_reports
    SET approval_status = ${status}, approval_by = ${byUserId}, approval_at = now(),
        approval_comment = ${comment}
    WHERE id = ${reportId} AND approval_status = 'pending'
    RETURNING id`;
  return rows.length > 0;
}


export async function deleteReport(id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM op_reports WHERE id = ${id}`;
}

// ===== 集計 =====

export interface SummaryFilter {
  dateFrom: string;
  dateTo: string;
  factoryId?: string | null;
  lineId?: string | null;
  /** 'line'（工場×職場）または 'factory'（工場のみ） */
  groupBy?: "line" | "factory";
}

/**
 * 期間内の計画・実績・残業を工場／ラインごとに集計する。
 *
 * - 実績数量はその日の「最後の報告の実績」を採用する（累計で報告するため合計ではなく最終値）。
 * - 計画工数は 稼働時間（H）× 投入人数（日次計画に無ければライン標準）。
 * - 残業もその日の「最後の報告」の申請内容（人数 × 一人当たりの分）を使う。
 */
export async function summarize(filter: SummaryFilter): Promise<SummaryRow[]> {
  await ensureSchema();
  const sql = getSql();
  const byLine = (filter.groupBy ?? "line") === "line";

  // 日ごと・ラインごとに1行へ畳んでから集計する
  const rows = await sql.query(
    `WITH days AS (
       SELECT l.id AS line_id, d.report_date AS the_date
       FROM op_lines l
       JOIN (
         SELECT line_id, report_date FROM op_reports
         WHERE report_date BETWEEN $1 AND $2
         UNION
         SELECT line_id, plan_date FROM op_daily_plans
         WHERE plan_date BETWEEN $1 AND $2
       ) d(line_id, report_date) ON d.line_id = l.id
       WHERE ($3::uuid IS NULL OR l.factory_id = $3)
         AND ($4::uuid IS NULL OR l.id = $4)
     ),
     last_report AS (
       SELECT DISTINCT ON (r.line_id, r.report_date)
              r.line_id, r.report_date, r.actual_qty, r.planned_qty,
              CASE WHEN r.overtime_decision = 'do' THEN r.overtime_headcount ELSE 0 END AS ot_heads,
              CASE WHEN r.overtime_decision = 'do'
                   THEN r.overtime_headcount * r.overtime_minutes ELSE 0 END AS ot_man_minutes
       FROM op_reports r
       WHERE r.report_date BETWEEN $1 AND $2
       ORDER BY r.line_id, r.report_date, r.report_time DESC
     ),
     delayed AS (
       SELECT r.line_id, r.report_date, COUNT(*) AS cnt
       FROM op_reports r
       WHERE r.report_date BETWEEN $1 AND $2 AND r.progress_status = 'delayed'
       GROUP BY r.line_id, r.report_date
     )
     SELECT l.factory_id, f.name AS factory_name, f.sort_order AS factory_sort,
            l.id AS line_id, l.name AS line_name, l.line_type, l.sort_order AS line_sort,
            l.work_hours, l.headcount AS line_headcount,
            d.the_date,
            COALESCE(p.planned_qty, lr.planned_qty, 0) AS planned_qty,
            COALESCE(lr.actual_qty, 0) AS actual_qty,
            COALESCE(p.headcount, l.headcount) AS headcount,
            COALESCE(lr.ot_man_minutes, 0) AS ot_minutes,
            COALESCE(lr.ot_heads, 0) AS ot_heads,
            COALESCE(dl.cnt, 0) AS delayed_cnt
     FROM days d
     JOIN op_lines l ON l.id = d.line_id
     JOIN op_factories f ON f.id = l.factory_id
     LEFT JOIN op_daily_plans p ON p.line_id = d.line_id AND p.plan_date = d.the_date
     LEFT JOIN last_report lr ON lr.line_id = d.line_id AND lr.report_date = d.the_date
     LEFT JOIN delayed dl ON dl.line_id = d.line_id AND dl.report_date = d.the_date`,
    [filter.dateFrom, filter.dateTo, filter.factoryId ?? null, filter.lineId ?? null]
  );

  type Acc = SummaryRow & { factorySort: number; lineSort: number };
  const acc = new Map<string, Acc>();

  for (const r of rows as any[]) {
    const key = byLine ? `${r.factory_id}/${r.line_id}` : String(r.factory_id);
    let a = acc.get(key);
    if (!a) {
      a = {
        factoryId: r.factory_id as string,
        factoryName: r.factory_name as string,
        lineId: byLine ? (r.line_id as string) : null,
        lineName: byLine ? (r.line_name as string) : null,
        lineType: byLine ? toLineType(r.line_type) : null,
        plannedQty: 0,
        actualQty: 0,
        plannedManHours: 0,
        overtimeManHours: 0,
        overtimeDays: 0,
        overtimeHeads: 0,
        delayedReports: 0,
        factorySort: num(r.factory_sort),
        lineSort: num(r.line_sort),
      };
      acc.set(key, a);
    }
    a.plannedQty += num(r.planned_qty);
    a.actualQty += num(r.actual_qty);
    a.plannedManHours += plannedManHoursOf(num(r.work_hours), num(r.headcount));
    const otMinutes = num(r.ot_minutes);
    a.overtimeManHours += otMinutes / 60;
    a.overtimeHeads += num(r.ot_heads);
    if (otMinutes > 0) a.overtimeDays += 1;
    a.delayedReports += num(r.delayed_cnt);
  }

  return [...acc.values()]
    .sort((x, y) => x.factorySort - y.factorySort || x.lineSort - y.lineSort)
    .map((a): SummaryRow => ({
      factoryId: a.factoryId,
      factoryName: a.factoryName,
      lineId: a.lineId,
      lineName: a.lineName,
      lineType: a.lineType,
      plannedQty: a.plannedQty,
      actualQty: a.actualQty,
      plannedManHours: a.plannedManHours,
      overtimeManHours: a.overtimeManHours,
      overtimeDays: a.overtimeDays,
      overtimeHeads: a.overtimeHeads,
      delayedReports: a.delayedReports,
    }));
}

