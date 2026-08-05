import Link from "next/link";
import { Inbox } from "lucide-react";
import { requireAdminSession } from "@/lib/session";
import { listMyOvertimeRequests, listPendingApprovals, listReports } from "@/lib/db";
import { approveReportAction } from "@/lib/actions";
import { addDays, formatDate, formatDateTime, formatHours, todayString } from "@/lib/format";
import {
  OVERTIME_DECISION_LABEL,
  QTY_LABEL,
  REASON_LABEL,
  type Report,
} from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SubmitButton from "@/components/SubmitButton";
import { ApprovalBadge, OvertimeDecisionBadge } from "@/components/Badges";

export const dynamic = "force-dynamic";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";

/**
 * 承認・申請。
 * - 実施(do)      … 報告者の上長が承認し、承認済みが生産管理部に届く（上長未設定は生産管理部が承認）
 * - 翌日回し(defer)… 生産管理部が許可する
 */
export default async function ApprovalsPage() {
  const session = await requireAdminSession();

  let pending: Report[], mine: Report[], delivered: Report[];
  try {
    [pending, mine, delivered] = await Promise.all([
      listPendingApprovals({ userId: session.userId, canEditMaster: session.canEditMaster }),
      listMyOvertimeRequests(session.userId),
      // 生産管理部に届く「承認済みの残業実施」（直近2週間）
      session.canEditMaster
        ? listReports({
            dateFrom: addDays(todayString(), -14),
            overtimeDecision: "do",
            approvalStatus: "approved",
            limit: 100,
          })
        : Promise.resolve([]),
    ]);
  } catch (e) {
    console.error("[approvals]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="承認・申請" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="承認・申請"
        description="残業の実施は上長が承認し、承認済みが生産管理部へ届きます。翌日回しは生産管理部が許可します。"
      />

      {/* ===== あなたの承認待ち ===== */}
      <section className="max-w-4xl">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          あなたの承認待ち
          <span className="ml-2 text-xs font-normal text-slate-500">
            {pending.length}件
            {session.canEditMaster ? "（生産管理部宛ての翌日回し・上長未設定の申請を含む）" : ""}
          </span>
        </h2>
        {pending.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
            <Inbox className="h-4 w-4" />
            承認待ちの申請はありません。
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => (
              <ApprovalCard key={r.id} report={r} />
            ))}
          </ul>
        )}
      </section>

      {/* ===== 生産管理部に届いた承認済み残業 ===== */}
      {session.canEditMaster ? (
        <section className="mt-8 max-w-4xl">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            生産管理部に届いた残業（承認済み・直近2週間）
            <span className="ml-2 text-xs font-normal text-slate-500">{delivered.length}件</span>
          </h2>
          {delivered.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
              直近2週間に承認された残業はありません。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 text-left">日付</th>
                    <th className="px-3 py-2 text-left">工場 / ライン</th>
                    <th className="px-3 py-2 text-left">申請者</th>
                    <th className="px-3 py-2 text-right">人数 × 時間</th>
                    <th className="px-3 py-2 text-right">延べ</th>
                    <th className="px-3 py-2 text-left">承認</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {delivered.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 tabular-nums">{formatDate(r.reportDate)}</td>
                      <td className="px-3 py-2">
                        {r.factoryName} / {r.lineName}
                      </td>
                      <td className="px-3 py-2">{r.reportedByName ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.overtimeHeadcount}名 × {r.overtimeMinutesPerPerson}分
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatHours(r.overtimeManMinutes)}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {r.approvalByName ?? "—"}（{formatDateTime(r.approvalAt)}）
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">
            期間全体の残業工数・一人当たり出来高は
            <Link href="/summary" className="mx-1 text-brand-700 underline">
              集計
            </Link>
            で確認できます。
          </p>
        </section>
      ) : null}

      {/* ===== 自分の申請 ===== */}
      <section className="mt-8 max-w-4xl">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          自分の申請
          <span className="ml-2 text-xs font-normal text-slate-500">直近{mine.length}件</span>
        </h2>
        {mine.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
            残業・翌日回しの申請はまだありません。
            <Link href="/report" className="ml-1 text-brand-700 underline">
              進捗・残業の入力
            </Link>
            から登録すると、ここで承認状況を確認できます。
          </p>
        ) : (
          <ul className="space-y-2">
            {mine.map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="tabular-nums text-slate-700">{formatDate(r.reportDate)}</span>
                  <span className="font-medium text-slate-900">
                    {r.factoryName} / {r.lineName}
                  </span>
                  <OvertimeDecisionBadge decision={r.overtimeDecision} />
                  <ApprovalBadge status={r.approvalStatus} />
                  <span className="ml-auto text-xs text-slate-500">
                    {r.approvalStatus === "pending"
                      ? r.overtimeDecision === "defer"
                        ? "生産管理部の許可待ち"
                        : `承認者：${r.approverName ?? "生産管理部"}`
                      : `${r.approvalByName ?? "—"}（${formatDateTime(r.approvalAt)}）`}
                  </span>
                </div>
                {r.approvalStatus === "rejected" && r.approvalComment ? (
                  <p className="mt-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                    差し戻し理由：{r.approvalComment}
                    <Link
                      href={`/report?line=${encodeURIComponent(r.lineId)}&date=${encodeURIComponent(r.reportDate)}`}
                      className="ml-2 underline"
                    >
                      修正して再申請 →
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** 承認待ち1件のカード（承認／差し戻し）。 */
function ApprovalCard({ report: r }: { report: Report }) {
  const qty = QTY_LABEL[r.lineType];
  const isDefer = r.overtimeDecision === "defer";
  return (
    <li className="rounded-xl border border-amber-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="tabular-nums font-medium text-slate-900">{formatDate(r.reportDate)}</span>
        <span className="font-medium text-slate-900">
          {r.factoryName} / {r.lineName}
        </span>
        <OvertimeDecisionBadge decision={r.overtimeDecision} />
        {isDefer ? (
          <span className="text-xs text-sky-700">生産管理部の許可が必要です</span>
        ) : null}
        <span className="ml-auto text-xs text-slate-500">
          申請：{r.reportedByName ?? "—"}（{formatDateTime(r.reportedAt)}）
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-600">
        実績 {r.actualQty}
        {qty.unit} / 理論 {r.theoreticalQty}
        {qty.unit} / 計画 {r.plannedQty}
        {qty.unit}
        {r.reasonCode ? (
          <span className="ml-3 font-medium">{REASON_LABEL[r.reasonCode]}</span>
        ) : null}
        {r.reason ? <span className="ml-1">{r.reason}</span> : null}
      </p>

      {r.overtimeManMinutes > 0 ? (
        <p className="mt-2 text-sm text-slate-700">
          残業：
          <strong className="tabular-nums">
            {r.overtimeHeadcount}名 × {r.overtimeMinutesPerPerson}分
          </strong>
          <span className="ml-1 text-slate-500">（延べ {formatHours(r.overtimeManMinutes)}）</span>
        </p>
      ) : null}
      {isDefer ? (
        <p className="mt-2 text-xs text-slate-600">
          {OVERTIME_DECISION_LABEL.defer}：残った{qty.name}を翌日の計画に回します。
        </p>
      ) : null}

      <form action={approveReportAction} className="mt-3 flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={r.id} />
        <input
          type="text"
          name="comment"
          maxLength={200}
          placeholder="コメント（差し戻し時は必須）"
          className={`${inputCls} min-w-[16rem] flex-1`}
        />
        <SubmitButton
          name="verdict"
          value="approve"
          pendingLabel="処理中…"
          className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {isDefer ? "許可する" : "承認する"}
        </SubmitButton>
        <SubmitButton
          name="verdict"
          value="reject"
          pendingLabel="処理中…"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        >
          差し戻す
        </SubmitButton>
      </form>
    </li>
  );
}
