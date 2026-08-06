import { QTY_LABEL, REASON_LABEL, type Report } from "@/lib/types";

/**
 * 翌日回しの許可で「なぜ遅れたのか」を読み取るための表示。
 *
 * 図ではなく文章で分かることが求められているので、理由を主役にする。
 * 理由区分を見出し、記載された理由をその下に大きく置き、
 * 遅れの数字（不足・計画に対する残り）は補足として小さく添える。
 */
export default function DelayVisual({ report: r }: { report: Report }) {
  const unit = QTY_LABEL[r.lineType].unit;
  const shortage = Math.max(0, r.theoreticalQty - r.actualQty);
  const remaining = Math.max(0, r.plannedQty - r.actualQty);

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {/* ===== 遅れの理由（主役） ===== */}
      <p className="text-xs font-medium text-slate-500">遅れの理由</p>
      {r.reasonCode ? (
        <p className="mt-1 text-base font-bold text-slate-900">{REASON_LABEL[r.reasonCode]}</p>
      ) : null}
      {r.reason ? (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
          {r.reason}
        </p>
      ) : !r.reasonCode ? (
        <p className="mt-1 text-sm text-slate-500">理由の記載がありません。</p>
      ) : null}
      {r.note ? <p className="mt-1 text-xs text-slate-500">備考：{r.note}</p> : null}

      {/* ===== 遅れの大きさ（補足） ===== */}
      <p className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600">
        {r.reportTime}時点で
        <strong className="mx-1 tabular-nums text-rose-600">
          {shortage}
          {unit}の遅れ
        </strong>
        （理論 {r.theoreticalQty}
        {unit} / 実績 {r.actualQty}
        {unit}）　本日計画 {r.plannedQty}
        {unit} に対して残り
        <strong className="ml-1 tabular-nums text-slate-900">
          {remaining}
          {unit}
        </strong>
      </p>
    </div>
  );
}
