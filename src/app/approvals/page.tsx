import Link from "next/link";
import { Inbox } from "lucide-react";
import { requireAdminSession } from "@/lib/session";
import {
  listMyOvertimeRequests,
  listPendingApprovals,
  listReports,
  listReportsOfDays,
} from "@/lib/db";
import { approveReportAction } from "@/lib/actions";
import { addDays, formatDate, formatDateTime, formatHours, todayString } from "@/lib/format";
import { OVERTIME_DECISION_LABEL, QTY_LABEL, REASON_LABEL, type Report } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SubmitButton from "@/components/SubmitButton";
import ReportChat from "@/components/ReportChat";
import DelayVisual from "@/components/DelayVisual";
import { ApprovalBadge, OvertimeDecisionBadge } from "@/components/Badges";

export const dynamic = "force-dynamic";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";

/**
 * 承認・申請。
 * - 実施(do)      … 承認は不要。生産管理部へ「報告」として届く（理由の把握が目的）
 * - 翌日回し(defer)… 生産管理部が許可する（遅れの状況を図で見て判断する）
 */
export default async function ApprovalsPage() {
  const session = await requireAdminSession();

  let pending: Report[], mine: Report[], delivered: Report[];
  let historyByKey = new Map<string, Report[]>();
  try {
    [pending, mine, delivered] = await Promise.all([
      listPendingApprovals({ canEditMaster: session.canEditMaster }),
      listMyOvertimeRequests(session.userId),
      // 生産管理部へ届く「残業を実施した報告」（承認不要。直近2週間）
      session.canEditMaster
        ? listReports({
            dateFrom: addDays(todayString(), -14),
            overtimeDecision: "do",
            limit: 100,
          })
        : Promise.resolve([]),
    ]);
    // 許可待ちの判断材料として、その日の推移をまとめて引く（1クエリ）
    historyByKey = await listReportsOfDays(
      pending.map((r) => ({ lineId: r.lineId, reportDate: r.reportDate }))
    );
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
        description="残業の実施は報告のみです（承認は不要）。翌日回しだけ生産管理部の許可が必要です。"
      />

      {/* ===== 許可待ち（翌日回し・生産管理部のみ） ===== */}
      {session.canEditMaster ? (
        <section className="max-w-4xl">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            翌日回しの許可待ち
            <span className="ml-2 text-xs font-normal text-slate-500">{pending.length}件</span>
          </h2>
          {pending.length === 0 ? (
            <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
              <Inbox className="h-4 w-4" />
              許可待ちの申請はありません。
            </p>
          ) : (
            <ul className="space-y-3">
              {pending.map((r) => (
                <ApprovalCard
                  key={r.id}
                  report={r}
                  history={historyByKey.get(`${r.lineId}|${r.reportDate}`)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* ===== 生産管理部に届いた承認済み残業 ===== */}
      {session.canEditMaster ? (
        <section className="mt-8 max-w-4xl">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            残業の実施報告（直近2週間）
            <span className="ml-2 text-xs font-normal text-slate-500">
              {delivered.length}件・承認不要。理由の把握用
            </span>
          </h2>
          {delivered.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
              直近2週間に残業の実施報告はありません。
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
                    <th className="px-3 py-2 text-left">理由</th>
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
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {r.reasonCode ? (
                          <span className="font-medium">{REASON_LABEL[r.reasonCode]}</span>
                        ) : null}
                        {r.reason ? <span className="ml-1">{r.reason}</span> : null}
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

      {/* ===== 自分の報告・申請 ===== */}
      <section className="mt-8 max-w-4xl">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          自分の残業報告・申請
          <span className="ml-2 text-xs font-normal text-slate-500">直近{mine.length}件</span>
        </h2>
        {mine.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
            残業・翌日回しの報告はまだありません。
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
                    {r.approvalStatus === null
                      ? "報告済み（承認は不要）"
                      : r.approvalStatus === "pending"
                        ? "生産管理部の許可待ち"
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

                {/* 承認カードと同じスレッド。申請者から承認者へ補足・相談ができる */}
                <ReportChat
                  className="mt-2"
                  reportId={r.id}
                  title={`${formatDate(r.reportDate)} ${r.factoryName} / ${r.lineName} 残業申請`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * 翌日回しの許可待ち1件。
 * 「なぜ遅れたのか」を判断できるよう、数字だけでなく DelayVisual で
 * 計画・理論・実績の関係と当日の推移を図で見せる。
 */
function ApprovalCard({ report: r, history }: { report: Report; history?: Report[] }) {
  const qty = QTY_LABEL[r.lineType];
  return (
    <li className="rounded-xl border border-sky-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="tabular-nums font-medium text-slate-900">{formatDate(r.reportDate)}</span>
        <span className="font-medium text-slate-900">
          {r.factoryName} / {r.lineName}
        </span>
        <OvertimeDecisionBadge decision={r.overtimeDecision} />
        <span className="text-xs text-sky-700">生産管理部の許可が必要です</span>
        <span className="ml-auto text-xs text-slate-500">
          申請：{r.reportedByName ?? "—"}（{formatDateTime(r.reportedAt)}）
        </span>
      </div>

      {/* 遅れの状況（帯グラフ・理由・当日の推移） */}
      <DelayVisual report={r} history={history} />

      <p className="mt-2 text-xs text-slate-600">
        {OVERTIME_DECISION_LABEL.defer}：残業せず、残った{qty.name}を翌日の計画に回します。
      </p>

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
          許可する
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

      {/* 承認前の確認・相談。発言は申請者の LINE WORKS へ通知される */}
      <ReportChat
        className="mt-3 border-t border-slate-100 pt-3"
        reportId={r.id}
        title={`${formatDate(r.reportDate)} ${r.factoryName} / ${r.lineName} 残業申請`}
      />
    </li>
  );
}
