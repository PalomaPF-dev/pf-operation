import Link from "next/link";
import { CheckCircle2, UserCheck } from "lucide-react";
import { requireAdminSession } from "@/lib/session";
import {
  getPlan,
  getUserScope,
  isLineInScope,
  listFactories,
  listLines,
  listReportsOfDay,
} from "@/lib/db";
import { saveReportAction, deleteReportAction } from "@/lib/actions";
import { formatDate, formatDateTime, formatHours, nowJstMinutes, minutesToTime, todayString } from "@/lib/format";
import {
  OVERTIME_DECISION_LABEL,
  PROGRESS_STATUS_LABEL,
  QTY_LABEL,
  REASON_LABEL,
  REPORT_KIND_LABEL,
} from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SubmitButton from "@/components/SubmitButton";
import ReportForm from "@/components/ReportForm";
import { ApprovalBadge, LineTypeBadge, ProgressBadge } from "@/components/Badges";

export const dynamic = "force-dynamic";

/**
 * 進捗・残業の入力画面。
 * 日付・工場・ラインを選ぶと、そのラインのライン実力から理論値を出し、
 * 実績・生産進捗・残業の要否（実施なら対象者と時間）まで1画面で登録する。
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; factory?: string; line?: string; saved?: string }>;
}) {
  const session = await requireAdminSession();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayString();

  let factories: Awaited<ReturnType<typeof listFactories>>;
  let lines: Awaited<ReturnType<typeof listLines>>;
  let scope: Awaited<ReturnType<typeof getUserScope>>;
  try {
    [factories, lines, scope] = await Promise.all([
      listFactories(),
      listLines({ activeOnly: true }),
      // 工場の管理者はポータルの所属で自工場に絞る（生産管理部・ポータル管理者は全工場）
      getUserScope(session),
    ]);
  } catch (e) {
    console.error("[report]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="進捗・残業の入力" />
        <DbErrorState />
      </div>
    );
  }

  // 担当が決まっている人は、そのラインだけを見せる（サーバーアクション側でも検証している）
  if (scope) {
    lines = lines.filter((l) => isLineInScope(scope, l));
    factories = factories.filter((f) => lines.some((l) => l.factoryId === f.id));
  }

  if (scope && lines.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="進捗・残業の入力" />
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          所属工場のラインが登録されていません。マスタ設定（ライン設定）をご確認ください。
        </div>
      </div>
    );
  }

  if (factories.length === 0 || lines.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="進捗・残業の入力" />
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          工場とラインの登録が必要です。
          <Link href="/masters" className="ml-1 text-brand-700 underline">
            マスタ設定
          </Link>
          から登録してください。
        </div>
      </div>
    );
  }

  // 工場は URL の指定を優先し、ラインはその工場の中から選ぶ
  // （ラインが1本も無い工場を選んだときは、ライン未選択のまま案内を出す）
  const factoryId =
    sp.factory && factories.some((f) => f.id === sp.factory)
      ? sp.factory
      : (lines.find((l) => l.id === sp.line)?.factoryId ?? lines[0].factoryId);
  const line =
    lines.find((l) => l.id === sp.line && l.factoryId === factoryId) ??
    lines.find((l) => l.factoryId === factoryId) ??
    null;

  const plan = line ? await getPlan(line.id, date) : null;
  const dayReports = line ? await listReportsOfDay(line.id, date) : [];
  const qty = QTY_LABEL[line?.lineType ?? "assembly"];

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="進捗・残業の入力"
        description="決められたタイミングで進捗を記録し、足りない場合は残業を申請します。"
      />

      {scope ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <UserCheck className="h-4 w-4 shrink-0" />
          所属工場（{factories.map((f) => f.name).join("・")}）のみ表示しています。
        </div>
      ) : null}

      {sp.saved ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          登録しました。
        </div>
      ) : null}

      <div className="max-w-3xl">
        <ReportForm
          key={`${date}-${line?.id ?? "none"}`}
          factories={factories}
          lines={lines}
          defaults={{
            date,
            factoryId,
            lineId: line?.id ?? "",
            now: minutesToTime(nowJstMinutes()),
            plannedQty: plan?.plannedQty ?? null,
            startTime: plan?.startTime ?? null,
            headcount: plan?.headcount ?? null,
          }}
          action={saveReportAction}
        />
      </div>

      {/* ===== その日の登録済み報告 ===== */}
      <section className="mt-8 max-w-3xl">
        <h2 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
          {formatDate(date)} の登録内容
          {line ? (
            <>
              <span className="font-normal text-slate-500">
                {line.factoryName} / {line.name}
              </span>
              <LineTypeBadge type={line.lineType} />
            </>
          ) : null}
        </h2>

        {dayReports.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
            この日の登録はまだありません。
          </p>
        ) : (
          <ul className="space-y-2">
            {dayReports.map((r) => (
              <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold tabular-nums text-slate-900">{r.reportTime}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    {REPORT_KIND_LABEL[r.kind]}
                  </span>
                  <span className="tabular-nums text-slate-600">
                    実績 {r.actualQty}
                    {qty.unit} / 理論 {r.theoreticalQty}
                    {qty.unit} / 計画 {r.plannedQty}
                    {qty.unit}
                  </span>
                  <ProgressBadge gap={r.theoreticalQty - r.actualQty} unit={qty.unit} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      r.progressStatus === "delayed"
                        ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200"
                        : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                    }`}
                  >
                    {PROGRESS_STATUS_LABEL[r.progressStatus]}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
                    残業：{OVERTIME_DECISION_LABEL[r.overtimeDecision]}
                    {r.overtimeManMinutes > 0
                      ? `（${r.overtimeHeadcount}名 × ${r.overtimeMinutesPerPerson}分 ＝ ${formatHours(r.overtimeManMinutes)}）`
                      : ""}
                    <ApprovalBadge status={r.approvalStatus} />
                  </span>
                </div>


                {r.reason || r.note ? (
                  <p className="mt-2 text-xs text-slate-600">
                    {r.reasonCode ? (
                      <span className="font-medium">{REASON_LABEL[r.reasonCode]}：</span>
                    ) : null}
                    {r.reason}
                    {r.note ? <span className="ml-2 text-slate-500">{r.note}</span> : null}
                  </p>
                ) : null}

                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                  <span>
                    {r.reportedByName ?? "—"}（{formatDateTime(r.reportedAt)}）
                  </span>
                  <form action={deleteReportAction} className="ml-auto">
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton
                      pendingLabel="削除中…"
                      confirm={`${r.reportTime} の報告を削除します。よろしいですか？`}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                    >
                      削除
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
