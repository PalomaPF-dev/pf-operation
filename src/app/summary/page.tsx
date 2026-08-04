import { Download, Printer } from "lucide-react";
import { requireAdminSession } from "@/lib/session";
import { listFactories, listLines, summarize, summarizeByWorker } from "@/lib/db";
import {
  formatDate,
  formatHours,
  formatManHours,
  formatNumber,
  formatPercent,
  monthStartString,
  todayString,
} from "@/lib/format";
import { QTY_LABEL, summaryMetrics } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import { LineTypeBadge } from "@/components/Badges";

export const dynamic = "force-dynamic";

/**
 * 集計ページ。
 * 期間内の工場／ラインごとに、残業がどれだけ発生したかと、一人当たり出来高を検証する。
 * 一人当たり出来高 ＝ 実績数量 ÷（計画工数 ＋ 残業工数）。
 */
export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    factory?: string;
    line?: string;
    group?: string;
  }>;
}) {
  await requireAdminSession();
  const sp = await searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : monthStartString();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : todayString();
  const factoryId = sp.factory || null;
  const lineId = sp.line || null;
  const groupBy: "factory" | "line" = sp.group === "factory" ? "factory" : "line";

  const filter = { dateFrom: from, dateTo: to, factoryId, lineId, groupBy };

  let factories, lines, rows, workerRows;
  try {
    [factories, lines, rows, workerRows] = await Promise.all([
      listFactories(),
      listLines(),
      summarize(filter),
      summarizeByWorker(filter),
    ]);
  } catch (e) {
    console.error("[summary]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="集計" />
        <DbErrorState />
      </div>
    );
  }

  const total = rows.reduce(
    (acc, r) => ({
      plannedQty: acc.plannedQty + r.plannedQty,
      actualQty: acc.actualQty + r.actualQty,
      plannedManHours: acc.plannedManHours + r.plannedManHours,
      overtimeManHours: acc.overtimeManHours + r.overtimeManHours,
      overtimeHeads: acc.overtimeHeads + r.overtimeHeads,
      delayedReports: acc.delayedReports + r.delayedReports,
    }),
    {
      plannedQty: 0,
      actualQty: 0,
      plannedManHours: 0,
      overtimeManHours: 0,
      overtimeHeads: 0,
      delayedReports: 0,
    }
  );
  const totalManHours = total.plannedManHours + total.overtimeManHours;

  const qs = new URLSearchParams({ from, to, group: groupBy });
  if (factoryId) qs.set("factory", factoryId);
  if (lineId) qs.set("line", lineId);

  const inputCls =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="集計"
        description={`${formatDate(from)}〜${formatDate(to)} の残業発生量と一人当たり出来高`}
        actions={
          <>
            <a
              href={`/api/summary/export?${qs.toString()}`}
              className="no-print flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              CSV
            </a>
            <span className="no-print hidden items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 sm:flex">
              <Printer className="h-4 w-4" />
              印刷は Ctrl+P
            </span>
          </>
        }
      />

      <form method="get" className="no-print mb-4 flex flex-wrap items-end gap-2">
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
          集計単位
          <select name="group" defaultValue={groupBy} className={inputCls}>
            <option value="line">工場×ライン</option>
            <option value="factory">工場のみ</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          表示
        </button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="実績数量"
          value={formatNumber(total.actualQty)}
          sub={`計画比 ${formatPercent(total.plannedQty > 0 ? total.actualQty / total.plannedQty : null)}`}
        />
        <Stat
          label="残業工数"
          value={formatManHours(total.overtimeManHours)}
          unit="人時"
          sub={`延べ${total.overtimeHeads}名`}
        />
        <Stat
          label="総工数"
          value={formatManHours(totalManHours)}
          unit="人時"
          sub={`計画 ${formatManHours(total.plannedManHours)}`}
        />
        <Stat
          label="一人当たり出来高"
          value={totalManHours > 0 ? (total.actualQty / totalManHours).toFixed(2) : "—"}
          unit="/人時"
          sub={`遅延報告 ${total.delayedReports}件`}
        />
      </div>

      <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="print-table w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
              <th className="px-3 py-2">工場</th>
              {groupBy === "line" ? <th className="px-3 py-2">ライン</th> : null}
              {groupBy === "line" ? <th className="px-3 py-2">種別</th> : null}
              <th className="px-3 py-2 text-right">計画数量</th>
              <th className="px-3 py-2 text-right">実績数量</th>
              <th className="px-3 py-2 text-right">達成率</th>
              <th className="px-3 py-2 text-right">計画工数</th>
              <th className="px-3 py-2 text-right">残業工数</th>
              <th className="px-3 py-2 text-right">残業日数</th>
              <th className="px-3 py-2 text-right">延べ人数</th>
              <th className="px-3 py-2 text-right">遅延報告</th>
              <th className="px-3 py-2 text-right">一人当たり出来高</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
                  該当するデータがありません。
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const m = summaryMetrics(r);
                const unit = r.lineType ? QTY_LABEL[r.lineType].unit : "";
                return (
                  <tr
                    key={`${r.factoryId}-${r.lineId ?? "all"}`}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="px-3 py-2 text-slate-600">{r.factoryName}</td>
                    {groupBy === "line" ? (
                      <td className="px-3 py-2 font-medium text-slate-900">{r.lineName}</td>
                    ) : null}
                    {groupBy === "line" ? (
                      <td className="px-3 py-2">
                        {r.lineType ? <LineTypeBadge type={r.lineType} /> : null}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(r.plannedQty)}
                      {unit}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(r.actualQty)}
                      {unit}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        m.achievement !== null && m.achievement < 1 ? "text-rose-600" : ""
                      }`}
                    >
                      {formatPercent(m.achievement)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {formatManHours(r.plannedManHours)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {formatManHours(r.overtimeManHours)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.overtimeDays}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.overtimeHeads}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {r.delayedReports}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {m.perManHour === null ? "—" : m.perManHour.toFixed(2)}
                      {unit ? <span className="text-xs font-normal">{unit}/人時</span> : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-slate-900">
        作業者別の残業時間
        <span className="ml-2 text-xs font-normal text-slate-500">
          偏りがないかを確認します（多い順）
        </span>
      </h2>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="print-table w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
              <th className="px-3 py-2">工場</th>
              <th className="px-3 py-2">社員番号</th>
              <th className="px-3 py-2">氏名</th>
              <th className="px-3 py-2 text-right">残業時間</th>
              <th className="px-3 py-2 text-right">日数</th>
            </tr>
          </thead>
          <tbody>
            {workerRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  期間内の残業はありません。
                </td>
              </tr>
            ) : (
              workerRows.map((w) => (
                <tr key={w.workerId} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 text-slate-600">{w.factoryName}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{w.employeeNo}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">{w.name}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatHours(w.minutes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{w.days}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold tabular-nums text-slate-900">
        {value}
        {unit ? <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div> : null}
    </div>
  );
}
