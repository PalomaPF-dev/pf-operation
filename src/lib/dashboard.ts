import { nowJstMinutes, timeToMinutes, todayString } from "./format";
import { endTimeOf, theoreticalAt } from "./capacity";
import type { DailyPlan, Line, Report } from "./types";

/** ダッシュボードで使う、1ラインぶんの状態。 */
export interface LineStatus {
  line: Line;
  plan: DailyPlan | null;
  /** その日の最終報告 */
  last: Report | null;
  /** 最終報告時点の差異（理論 − 実績）。未報告なら null */
  gap: number | null;
  /** その日の残業（延べ分・人数）。最終報告の申請内容（人数×時間）から */
  overtimeMinutes: number;
  overtimeHeads: number;
  /** 「いま時点」の理論値（当日のみ。未報告のラインの遅れ検知に使う） */
  theoreticalNow: number | null;
  state: "no_plan" | "unreported" | "behind" | "ontrack" | "done";
}

export const STATE_LABEL: Record<LineStatus["state"], string> = {
  no_plan: "計画未登録",
  unreported: "未報告",
  behind: "遅延",
  ontrack: "順調",
  done: "計画完納",
};

export const STATE_CLASS: Record<LineStatus["state"], string> = {
  no_plan: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  unreported: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  behind: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  ontrack: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  done: "bg-teal-50 text-teal-700 ring-1 ring-teal-200",
};

/**
 * ライン・計画・最終報告から表示用の状態を組み立てる。
 *
 * 「未報告」は、当日で始業を過ぎているのに1件も報告が無いラインを指す
 * （過去日は報告が無ければ常に未報告）。
 */
export function buildLineStatus(args: {
  line: Line;
  plan: DailyPlan | null;
  last: Report | null;
  date: string;
}): LineStatus {
  const { line, plan, last, date } = args;
  const today = todayString();
  const isToday = date === today;
  const isFuture = date > today;

  const startTime = plan?.startTime ?? line.startTime;
  const nowTime = minutesToHHMM(nowJstMinutes());
  const started = isFuture
    ? false
    : !isToday || nowJstMinutes() >= (timeToMinutes(startTime) ?? 0);

  const theoreticalNow =
    isToday && started
      ? theoreticalAt({ ...line, startTime }, nowTime, plan?.plannedQty)
      : null;

  const gap = last ? last.theoreticalQty - last.actualQty : null;
  const overtimeMinutes = last ? last.overtimeManMinutes : 0;
  const overtimeHeads = last ? last.overtimeHeadcount : 0;

  let state: LineStatus["state"];
  if (!plan && !last) state = isFuture ? "no_plan" : started ? "unreported" : "no_plan";
  else if (!last) state = "unreported";
  else if (last.progressStatus === "delayed" || (gap ?? 0) > 0) state = "behind";
  else if (last.plannedQty > 0 && last.actualQty >= last.plannedQty) state = "done";
  else state = "ontrack";

  return { line, plan, last, gap, overtimeMinutes, overtimeHeads, theoreticalNow, state };
}

function minutesToHHMM(m: number): string {
  const x = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}

/** 表示用の終業時刻（始業＋稼働時間＋休憩）。 */
export function shiftEnd(line: Line, plan: DailyPlan | null): string {
  return endTimeOf({ ...line, startTime: plan?.startTime ?? line.startTime });
}
