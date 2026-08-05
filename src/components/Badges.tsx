import {
  APPROVAL_STATUS_LABEL,
  LINE_TYPE_LABEL,
  OVERTIME_DECISION_LABEL,
  PROGRESS_STATUS_LABEL,
  type ApprovalStatus,
  type LineType,
  type OvertimeDecision,
  type ProgressStatus,
} from "@/lib/types";

const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium";

/** ライン種別（組立ライン／前工程）。 */
export function LineTypeBadge({ type }: { type: LineType }) {
  const cls =
    type === "assembly"
      ? "bg-teal-50 text-teal-700 ring-1 ring-teal-200"
      : "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200";
  return <span className={`${base} ${cls}`}>{LINE_TYPE_LABEL[type]}</span>;
}

/** 理論値との差異（プラスなら不足）。null は未報告。 */
export function ProgressBadge({ gap, unit }: { gap: number | null; unit: string }) {
  if (gap === null) {
    return <span className={`${base} bg-slate-100 text-slate-500 ring-1 ring-slate-200`}>未報告</span>;
  }
  if (gap <= 0) {
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`}>
        理論比 +{-gap}
        {unit}
      </span>
    );
  }
  return (
    <span className={`${base} bg-rose-50 text-rose-700 ring-1 ring-rose-200`}>
      不足 {gap}
      {unit}
    </span>
  );
}

/** 生産進捗（順調／遅延）。 */
export function ProgressStatusBadge({ status }: { status: ProgressStatus }) {
  const cls =
    status === "delayed"
      ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
      : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  return <span className={`${base} ${cls}`}>{PROGRESS_STATUS_LABEL[status]}</span>;
}

/** 残業の要否（実施／翌日回し／対象外）。 */
export function OvertimeDecisionBadge({ decision }: { decision: OvertimeDecision }) {
  const cls =
    decision === "do"
      ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
      : decision === "defer"
        ? "bg-sky-50 text-sky-700 ring-1 ring-sky-200"
        : "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
  return <span className={`${base} ${cls}`}>残業：{OVERTIME_DECISION_LABEL[decision]}</span>;
}

/** 承認状態（承認待ち／承認済み／差し戻し）。null（対象外）は出さない。 */
export function ApprovalBadge({ status }: { status: ApprovalStatus | null }) {
  if (!status) return null;
  const cls =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : status === "rejected"
        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
        : "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  return <span className={`${base} ${cls}`}>{APPROVAL_STATUS_LABEL[status]}</span>;
}
