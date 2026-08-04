import Link from "next/link";
import { AlertTriangle, ClipboardList, Clock, Factory as FactoryIcon } from "lucide-react";
import { requireAdminSession } from "@/lib/session";
import { latestReportsByDate, listFactories, listLines, listPlansByDate } from "@/lib/db";
import { buildLineStatus, shiftEnd, STATE_CLASS, STATE_LABEL } from "@/lib/dashboard";
import { formatDate, formatHours, formatNumber, todayString } from "@/lib/format";
import { QTY_LABEL } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import { LineTypeBadge } from "@/components/Badges";

export const dynamic = "force-dynamic";

/**
 * ダッシュボード。
 * 指定日（既定は当日）の全ラインについて、最終報告の進み具合・遅延・残業を一覧する。
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; factory?: string }>;
}) {
  await requireAdminSession();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayString();
  const factoryId = sp.factory || null;

  let factories, lines, plans, lastByLine;
  try {
    [factories, lines, plans, lastByLine] = await Promise.all([
      listFactories(),
      listLines({ factoryId, activeOnly: true }),
      listPlansByDate(date, factoryId),
      latestReportsByDate(date, factoryId),
    ]);
  } catch (e) {
    console.error("[dashboard]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="ダッシュボード" />
        <DbErrorState />
      </div>
    );
  }

  const planByLine = new Map(plans.map((p) => [p.lineId, p]));
  const statuses = lines.map((line) =>
    buildLineStatus({
      line,
      plan: planByLine.get(line.id) ?? null,
      last: lastByLine.get(line.id) ?? null,
      date,
    })
  );

  const behind = statuses.filter((s) => s.state === "behind").length;
  const unreported = statuses.filter((s) => s.state === "unreported").length;
  const noPlan = statuses.filter((s) => s.state === "no_plan").length;
  const otMinutes = statuses.reduce((s, x) => s + x.overtimeMinutes, 0);
  const otHeads = statuses.reduce((s, x) => s + x.overtimeHeads, 0);

  const inputCls =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-600 focus:outline-none focus:ring-1 focus:ring-purple-600";

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="ダッシュボード"
        description={`${formatDate(date)}の進捗と残業`}
        actions={
          <Link
            href="/report"
            className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-800"
          >
            進捗を入力する
          </Link>
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          日付
          <input type="date" name="date" defaultValue={date} className={inputCls} />
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
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          表示
        </button>
      </form>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="遅延しているライン"
          value={`${behind}`}
          unit="ライン"
          tone={behind > 0 ? "alert" : "normal"}
        />
        <StatCard
          icon={<ClipboardList className="h-4 w-4" />}
          label="未報告"
          value={`${unreported}`}
          unit="ライン"
          tone={unreported > 0 ? "warn" : "normal"}
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="残業"
          value={formatHours(otMinutes)}
          unit={`／延べ${otHeads}名`}
        />
        <StatCard
          icon={<FactoryIcon className="h-4 w-4" />}
          label="計画未登録"
          value={`${noPlan}`}
          unit="ライン"
          tone={noPlan > 0 ? "warn" : "normal"}
        />
      </div>

      {statuses.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          ラインが登録されていません。
          <Link href="/masters" className="ml-1 text-purple-700 underline">
            マスタ設定
          </Link>
          から登録してください。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="print-table w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-600">
                <th className="px-3 py-2">工場</th>
                <th className="px-3 py-2">ライン</th>
                <th className="px-3 py-2">種別</th>
                <th className="px-3 py-2 text-right">ライン実力</th>
                <th className="px-3 py-2 text-right">計画数</th>
                <th className="px-3 py-2">最終報告</th>
                <th className="px-3 py-2 text-right">理論</th>
                <th className="px-3 py-2 text-right">実績</th>
                <th className="px-3 py-2 text-right">差異</th>
                <th className="px-3 py-2 text-right">残業</th>
                <th className="px-3 py-2">状態</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => {
                const unit = QTY_LABEL[s.line.lineType].unit;
                return (
                  <tr key={s.line.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 text-slate-600">{s.line.factoryName}</td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/report?line=${s.line.id}&factory=${s.line.factoryId}&date=${date}`}
                        className="font-medium text-purple-700 hover:underline"
                      >
                        {s.line.name}
                      </Link>
                      <div className="text-[11px] text-slate-400">
                        {s.plan?.startTime ?? s.line.startTime}–{shiftEnd(s.line, s.plan)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <LineTypeBadge type={s.line.lineType} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {formatNumber(s.line.capacityPerDay)}
                      {unit}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.plan ? `${formatNumber(s.plan.plannedQty)}${unit}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {s.last ? s.last.reportTime : "—"}
                      {!s.last && s.theoreticalNow !== null ? (
                        <span className="ml-1 text-xs text-amber-700">
                          （現時点の目安 {s.theoreticalNow}
                          {unit}）
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {s.last ? formatNumber(s.last.theoreticalQty) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.last ? formatNumber(s.last.actualQty) : "—"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        s.gap !== null && s.gap > 0 ? "font-semibold text-rose-600" : ""
                      }`}
                    >
                      {s.gap === null
                        ? "—"
                        : s.gap > 0
                          ? `-${formatNumber(s.gap)}`
                          : `+${formatNumber(-s.gap)}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.overtimeMinutes > 0 ? formatHours(s.overtimeMinutes) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_CLASS[s.state]}`}
                      >
                        {STATE_LABEL[s.state]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  unit,
  tone = "normal",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  tone?: "normal" | "warn" | "alert";
}) {
  const toneCls =
    tone === "alert" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`text-xl font-bold tabular-nums ${toneCls}`}>
        {value}
        {unit ? <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span> : null}
      </div>
    </div>
  );
}
