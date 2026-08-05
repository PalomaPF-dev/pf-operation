import { getAdminSession } from "@/lib/session";
import { summarize } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { monthStartString, todayString } from "@/lib/format";
import { LINE_TYPE_LABEL, summaryMetrics } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 集計ページと同じ条件で CSV を出力する（工場・ライン別）。 */
export async function GET(req: Request) {
  const session = await getAdminSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(url.searchParams.get("from"))
    ? url.searchParams.get("from")!
    : monthStartString();
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : todayString();
  const filter = {
    dateFrom: from,
    dateTo: to,
    factoryId: url.searchParams.get("factory") || null,
    lineId: url.searchParams.get("line") || null,
    groupBy: url.searchParams.get("group") === "factory" ? ("factory" as const) : ("line" as const),
  };

  try {
    const rows = await summarize(filter);

    const lineCsv = toCsv(
      [
        "工場",
        "ライン",
        "種別",
        "計画数量",
        "実績数量",
        "達成率(%)",
        "計画工数(人時)",
        "残業工数(人時)",
        "総工数(人時)",
        "残業日数",
        "延べ人数",
        "遅延報告件数",
        "一人当たり出来高",
      ],
      rows.map((r) => {
        const m = summaryMetrics(r);
        return [
          r.factoryName,
          r.lineName ?? "",
          r.lineType ? LINE_TYPE_LABEL[r.lineType] : "",
          r.plannedQty,
          r.actualQty,
          m.achievement === null ? "" : (m.achievement * 100).toFixed(1),
          r.plannedManHours.toFixed(1),
          r.overtimeManHours.toFixed(1),
          m.totalManHours.toFixed(1),
          r.overtimeDays,
          r.overtimeHeads,
          r.delayedReports,
          m.perManHour === null ? "" : m.perManHour.toFixed(2),
        ];
      })
    );


    return csvResponse(`進捗集計_${from}_${to}.csv`, lineCsv);
  } catch (e) {
    console.error("[summary/export]", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
