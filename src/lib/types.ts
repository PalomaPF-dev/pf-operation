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
 * 承認が要るのは翌日回し(defer)＝生産管理部の許可だけ。
 * 実施(do) は承認不要で、生産管理部へ報告として届く（対象外(none) と同じく null）。
 */
export type ApprovalStatus = "pending" | "approved" | "rejected";

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "許可待ち",
  approved: "許可済み",
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

/** 定期報告1件（進捗チェック／終業後）。残業の申請内容（人数×時間）も同じ1件に含める。 */
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
  /* ----- 承認ワークフロー（翌日回しのみ。実施は承認不要の報告） ----- */
  /** 承認者。翌日回しは生産管理部宛てのため常に NULL */
  approverId: string | null;
  approverName: string | null;
  /** 承認状態。NULL は承認対象外（残業なし） */
  approvalStatus: ApprovalStatus | null;
  approvalByName: string | null;
  approvalAt: string | null;
  approvalComment: string | null;
  /** 残業の人数（実施のとき） */
  overtimeHeadcount: number;
  /** 一人当たりの残業時間（分） */
  overtimeMinutesPerPerson: number;
  /** 延べ残業（人・分）＝ 人数 × 一人当たりの分 */
  overtimeManMinutes: number;
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


/**
 * 入力を促す定期通知の設定。
 * 工場（ラインは任意）ごとに、何曜日の何時に誰へ送るかを持つ。
 */
export interface Reminder {
  id: string;
  factoryId: string;
  factoryName: string;
  /** 特定ラインを促すとき。null なら工場全体 */
  lineId: string | null;
  lineName: string | null;
  /** 通知時刻 "HH:MM"（JST） */
  remindTime: string;
  /** 送る曜日（0=日 … 6=土） */
  weekdays: number[];
  /** 宛先の社員番号。空なら対象工場のメンバー全員 */
  recipients: string[];
  message: string | null;
  /** その時点で報告済みなら送らない */
  skipIfReported: boolean;
  active: boolean;
  /** 最後に送った日（JST）。同じ日の二重送信を防ぐ */
  lastSentDate: string | null;
}

export const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 曜日の配列を「月・火・水・木・金」のような表示にする。 */
export function formatWeekdays(days: number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (sorted.length === 0) return "なし";
  if (sorted.length === 7) return "毎日";
  if (sorted.join(",") === "1,2,3,4,5") return "平日";
  return sorted.map((d) => WEEKDAY_LABEL[d]).join("・");
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
