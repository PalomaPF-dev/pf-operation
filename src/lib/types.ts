/** 進捗管理のドメイン型（DB 行を UI で扱いやすい形にしたもの）。 */

/** ラインの種別。組立ライン＝日量台数を追う／前工程＝計画された製造指図の消化を追う。 */
export type LineType = "assembly" | "process";

export const LINE_TYPE_LABEL: Record<LineType, string> = {
  assembly: "組立ライン",
  process: "前工程",
};

/** 種別ごとの数量の呼び名（画面の見出し・単位に使う）。 */
export const QTY_LABEL: Record<LineType, { name: string; unit: string; capacity: string }> = {
  assembly: { name: "台数", unit: "台", capacity: "ライン実力" },
  process: { name: "製造指図", unit: "件", capacity: "処理能力" },
};

export function isLineType(v: unknown): v is LineType {
  return v === "assembly" || v === "process";
}

/** 入力タイミング。進捗チェック＝就業中の途中経過／終業後＝1日の締め。 */
export type ReportKind = "checkpoint" | "closing";

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  checkpoint: "進捗チェック",
  closing: "終業後",
};

export function isReportKind(v: unknown): v is ReportKind {
  return v === "checkpoint" || v === "closing";
}

/** 生産進捗の自己申告。理論値との比較で初期値を出すが、最終的には入力者が選ぶ。 */
export type ProgressStatus = "ontrack" | "delayed";

export const PROGRESS_STATUS_LABEL: Record<ProgressStatus, string> = {
  ontrack: "順調",
  delayed: "遅延",
};

export function isProgressStatus(v: unknown): v is ProgressStatus {
  return v === "ontrack" || v === "delayed";
}

/** 残業の要否。 */
export type OvertimeDecision = "do" | "defer" | "none";

export const OVERTIME_DECISION_LABEL: Record<OvertimeDecision, string> = {
  do: "実施",
  defer: "翌日回し",
  none: "対象外（計画完納見込み）",
};

export const OVERTIME_DECISIONS: OvertimeDecision[] = ["do", "defer", "none"];

export function isOvertimeDecision(v: unknown): v is OvertimeDecision {
  return v === "do" || v === "defer" || v === "none";
}

/**
 * 承認ワークフローの状態。
 * 実施(do) は報告者の上長（未設定なら生産管理部）が承認し、承認済みが生産管理部へ届く。
 * 翌日回し(defer) は生産管理部が許可する。対象外(none) はワークフローなし（null）。
 */
export type ApprovalStatus = "pending" | "approved" | "rejected";

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "差し戻し",
};

export function isApprovalStatus(v: unknown): v is ApprovalStatus {
  return v === "pending" || v === "approved" || v === "rejected";
}

/** 残業・遅延の理由区分。 */
export type ReasonCode =
  | "shortfall"
  | "trouble"
  | "quality"
  | "material"
  | "absence"
  | "spot_order"
  | "other";

export const REASONS: { value: ReasonCode; label: string }[] = [
  { value: "shortfall", label: "計画未達（出来高不足）" },
  { value: "trouble", label: "設備トラブル・チョコ停" },
  { value: "quality", label: "品質不良・手直し" },
  { value: "material", label: "部材・前工程の遅延" },
  { value: "absence", label: "欠勤・要員不足" },
  { value: "spot_order", label: "特急・追加受注" },
  { value: "other", label: "その他" },
];

export const REASON_LABEL: Record<ReasonCode, string> = Object.fromEntries(
  REASONS.map((r) => [r.value, r.label])
) as Record<ReasonCode, string>;

export function isReasonCode(v: unknown): v is ReasonCode {
  return REASONS.some((r) => r.value === v);
}

export interface Factory {
  id: string;
  name: string;
  /** 社内の工場コード（02＝大口、0E＝清洲 など）。未設定なら null */
  code: string | null;
  sortOrder: number;
}

/** 休憩時間帯（実時刻）。理論値の計算で稼働時間から差し引く。 */
export interface BreakSpan {
  start: string;
  end: string;
}

export interface Line {
  id: string;
  factoryId: string;
  factoryName: string;
  /** ライン名（#1, #B など） */
  name: string;
  /** 器種（そのラインで作るもの。例「片面ホーロー」） */
  product: string | null;
  lineType: LineType;
  /** ライン実力（台/日・件/日） */
  capacityPerDay: number;
  /** 稼働時間（H）。ライン実力はこの時間で出せる量 */
  workHours: number;
  /** 始業時刻。日々の報告での既定値 */
  startTime: string;
  /** 休憩時間帯。理論値の計算で差し引く */
  breaks: BreakSpan[];
  /** 標準の投入人数（一人当たり出来高の分母） */
  headcount: number;
  note: string | null;
  active: boolean;
  sortOrder: number;
}

/** 1日1ラインの計画（計画数は報告時に入力され、ここに保持される）。 */
export interface DailyPlan {
  id: string;
  lineId: string;
  planDate: string;
  plannedQty: number;
  startTime: string;
  headcount: number;
  note: string | null;
}

export interface OvertimeMember {
  id: string;
  workerId: string;
  workerName: string;
  employeeNo: string;
  minutes: number;
}

/** 定期報告1件（進捗チェック／終業後）。残業の申請内容も同じ1件に含める。 */
export interface Report {
  id: string;
  lineId: string;
  lineName: string;
  lineType: LineType;
  factoryId: string;
  factoryName: string;
  reportDate: string;
  kind: ReportKind;
  reportTime: string;
  /** 始業時刻（理論値の計算に使った値） */
  startTime: string;
  /** その日の計画数 */
  plannedQty: number;
  /** チェック時刻時点の理論値（自動計算） */
  theoreticalQty: number;
  /** チェック時刻時点の実績 */
  actualQty: number;
  progressStatus: ProgressStatus;
  overtimeDecision: OvertimeDecision;
  reasonCode: ReasonCode | null;
  reason: string | null;
  note: string | null;
  reportedById: string | null;
  reportedByName: string | null;
  reportedAt: string | null;
  /* ----- 承認ワークフロー（実施＝上長承認 → 生産管理部へ／翌日回し＝生産管理部の許可） ----- */
  /** 承認者（上長）。NULL は生産管理部宛て（翌日回し、または上長未設定の実施） */
  approverId: string | null;
  approverName: string | null;
  /** 承認状態。NULL は承認対象外（残業なし） */
  approvalStatus: ApprovalStatus | null;
  approvalByName: string | null;
  approvalAt: string | null;
  approvalComment: string | null;
  members: OvertimeMember[];
  /** 残業時間の合計（分） */
  overtimeMinutes: number;
}

/**
 * マスタ上の「一人当たり時間出来高」（台/人・H）。
 * ライン実力 ÷（現状人員 × 総稼働時間）。人員か稼働時間が 0 なら null。
 * ※ 集計ページの「一人当たり出来高」は実績ベース。こちらは計画（実力）ベースの目安。
 */
export function capacityPerManHour(line: {
  capacityPerDay: number;
  headcount: number;
  workHours: number;
}): number | null {
  const manHours = line.headcount * line.workHours;
  if (manHours <= 0) return null;
  return line.capacityPerDay / manHours;
}

/** 理論値に対する差異（理論 − 実績）。プラスなら不足。 */
export function gapOf(report: { theoreticalQty: number; actualQty: number }): number {
  return report.theoreticalQty - report.actualQty;
}

export interface Worker {
  id: string;
  factoryId: string;
  factoryName: string;
  lineId: string | null;
  lineName: string | null;
  employeeNo: string;
  name: string;
  active: boolean;
}

/** 集計行（工場×職場、または工場のみ）。 */
export interface SummaryRow {
  factoryId: string;
  factoryName: string;
  lineId: string | null;
  lineName: string | null;
  lineType: LineType | null;
  /** 計画数量の合計（日ごとの計画数） */
  plannedQty: number;
  /** 実績数量の合計（日ごとの最終報告の実績） */
  actualQty: number;
  /** 計画工数（人時）＝ Σ 投入人数 × 正味稼働時間 */
  plannedManHours: number;
  /** 残業工数（人時）＝ Σ 対象者ごとの残業分 / 60 */
  overtimeManHours: number;
  /** 残業が発生した日数 */
  overtimeDays: number;
  /** 延べ残業対象人数 */
  overtimeHeads: number;
  /** 遅延と申告された報告の件数 */
  delayedReports: number;
}

/** 集計行から派生する指標（総工数・一人当たり出来高・達成率）。 */
export function summaryMetrics(row: SummaryRow) {
  const totalManHours = row.plannedManHours + row.overtimeManHours;
  return {
    totalManHours,
    /** 一人当たり出来高（数量/人時）。工数0なら null */
    perManHour: totalManHours > 0 ? row.actualQty / totalManHours : null,
    /** 計画達成率。計画0なら null */
    achievement: row.plannedQty > 0 ? row.actualQty / row.plannedQty : null,
  };
}
