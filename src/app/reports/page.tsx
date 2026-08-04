import Link from "next/link";
import { requireAdminSession } from "@/lib/session";
import { listFactories, listLines, listReports } from "@/lib/db";
import { deleteReportAction } from "@/lib/actions";
import { formatDate, formatDateTime, formatHours, monthStartString, todayString } from "@/lib/format";
import {
  QTY_LABEL,
  REASON_LABEL,
  REPORT_KIND_LABEL,
  isOvertimeDecision,
  isProgressStatus,
} from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SubmitButton from "@/components/SubmitButton";
import {
  LineTypeBadge,
  OvertimeDecisionBadge,
  ProgressStatusBadge,
} from "@/components/Badges";

export const dynamic = "force-dynamic";

/** 報告・残業申請の履歴。期間・工場・ライン・状態で絞り込む。 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    factory?: string;
    line?: string;
    decision?: string;
    status?: string;
  }>;
}) {
  await requireAdminSession();
  const sp = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : monthStartString();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : todayString();
  const factoryId = sp.factory || null;
  const lineId = sp.line || null;
  const overtimeDecision = isOvertimeDecision(sp.decision) ? sp.decision : null;
  const progressStatus = isProgressStatus(sp.status) ? sp.status : null;

  let factories, lines, reports;
  try {
    [factories, lines, reports] = await Promise.all([
      listFactories(),
      listLines(),
      listReports({ dateFrom: from, dateTo: to, factoryId, lineId, overtimeDecision, progressStatus }),
    ]);
  } catch (e) {
    console.error("[reports]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="報告履歴" />
        <DbErrorState />
      </div>
    );
  }

  const otMinutes = reports.reduce((s, r) => s + r.overtimeMinutes, 0);
  const otHeads = reports.reduce((s, r) => s + r.members.length, 0);

  const inputCls =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-600 focus:outline-none focus:ring-1 focus:ring-purple-600";

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="報告履歴"
        description={`${formatDate(from)}〜${formatDate(to)} の報告 ${reports.length}件（残業 ${formatHours(otMinutes)}／延べ${otHeads}名）`}
        actions={
          <Link
            href="/report"
            className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-800"
          >
            新規入力
          </Link>
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          開始日
          <input type="date" name="from" defaultValue={from} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          終了日
          <input type="date" name="to" defaultValue={to} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          工場
          <select name="factory" defaultValue={factoryId ?? ""} className={inputCls}>
            <option value="">すべて</option>
            {factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          ライン
          <select name="line" defaultValue={lineId ?? ""} className={inputCls}>
            <option value="">すべて</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.factoryName} / {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          生産進捗
          <select name="status" defaultValue={progressStatus ?? ""} className={inputCls}>
            <option value="">すべて</option>
            <option value="ontrack">順調</option>
            <option value="delayed">遅延</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          残業
          <select name="decision" defaultValue={overtimeDecision ?? ""} className={inputCls}>
            <option value="">すべて</option>
            <option value="do">実施</option>
            <option value="defer">翌日回し</option>
            <option value="none">対象外</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          表示
        </button>
      </form>

      {reports.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          該当する報告はありません。
        </div>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => {
            const unit = QTY_LABEL[r.lineType].unit;
            const gap = r.theoreticalQty - r.actualQty;
            return (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    {formatDate(r.reportDate)} {r.reportTime}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    {REPORT_KIND_LABEL[r.kind]}
                  </span>
                  <span className="text-sm text-slate-600">
                    {r.factoryName} / {r.lineName}
                  </span>
                  <LineTypeBadge type={r.lineType} />
                  <ProgressStatusBadge status={r.progressStatus} />
                  <OvertimeDecisionBadge decision={r.overtimeDecision} />
                </div>

                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-slate-700">
                  <span>
                    計画 {r.plannedQty}
                    {unit}
                  </span>
                  <span>
                    理論 {r.theoreticalQty}
                    {unit}
                  </span>
                  <span>
                    実績 {r.actualQty}
                    {unit}
                  </span>
                  <span className={gap > 0 ? "font-semibold text-rose-600" : "text-emerald-600"}>
                    差異 {gap > 0 ? `-${gap}` : `+${-gap}`}
                    {unit}
                  </span>
                  {r.overtimeMinutes > 0 ? (
                    <span className="font-semibold">
                      残業 {formatHours(r.overtimeMinutes)}／{r.members.length}名
                    </span>
                  ) : null}
                </div>

                {r.members.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {r.members.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                      >
                        <span className="tabular-nums text-slate-500">{m.employeeNo}</span>
                        {m.workerName}
                        <span className="tabular-nums font-medium">{formatHours(m.minutes)}</span>
                      </span>
                    ))}
                  </div>
                ) : null}

                {r.reason || r.note ? (
                  <p className="mb-2 text-xs text-slate-600">
                    {r.reasonCode ? (
                      <span className="font-medium">{REASON_LABEL[r.reasonCode]}：</span>
                    ) : null}
                    {r.reason}
                    {r.note ? <span className="ml-2 text-slate-500">{r.note}</span> : null}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>
                    入力 {r.reportedByName ?? "—"}（{formatDateTime(r.reportedAt)}）
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <Link
                      href={`/report?line=${r.lineId}&factory=${r.factoryId}&date=${r.reportDate}`}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                    >
                      この日を開く
                    </Link>
                    <form action={deleteReportAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton
                        pendingLabel="削除中…"
                        confirm="この報告を削除します。よろしいですか？"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                      >
                        削除
                      </SubmitButton>
                    </form>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
