import { timeToMinutes } from "./format";
import type { BreakSpan } from "./types";

/**
 * 理論値（その時刻までに出来ているはずの数量）の計算。
 *
 * 前提はマスタの「ライン実力（台/日）」と「稼働時間（H）」。
 * ライン実力 ÷ 稼働時間 ＝ 時間当たりの出来高 とみなし、
 * 始業から報告時刻までの経過時間から**休憩時間帯を実時刻で差し引いた**正味時間を掛ける。
 * 日量（計画数）を上限とする。
 */
export interface CapacityShape {
  capacityPerDay: number;
  workHours: number;
  startTime: string;
  breaks: BreakSpan[];
}

/** 日をまたぐ夜勤も扱えるよう、始業より前の時刻は翌日として +24h する。 */
function minutesFromStart(startMin: number, time: string): number {
  const t = timeToMinutes(time);
  if (t === null) return 0;
  return (t < startMin ? t + 24 * 60 : t) - startMin;
}

/** 始業から指定時刻までの間に含まれる休憩の合計（分）。 */
export function breakMinutesUntil(
  startTime: string,
  breaks: BreakSpan[],
  time: string
): number {
  const startMin = timeToMinutes(startTime) ?? 0;
  const elapsed = minutesFromStart(startMin, time);
  let total = 0;
  for (const b of breaks) {
    const bs = minutesFromStart(startMin, b.start);
    const be = minutesFromStart(startMin, b.end);
    if (be <= bs) continue;
    // 休憩のうち、始業〜指定時刻に重なっている分だけを差し引く
    const overlap = Math.min(be, elapsed) - Math.min(bs, elapsed);
    if (overlap > 0) total += overlap;
  }
  return total;
}

/** 休憩を全部含めた1日の休憩合計（分）。 */
export function totalBreakMinutes(breaks: BreakSpan[]): number {
  let total = 0;
  for (const b of breaks) {
    const bs = timeToMinutes(b.start);
    const be = timeToMinutes(b.end);
    if (bs === null || be === null) continue;
    const end = be <= bs ? be + 24 * 60 : be;
    total += end - bs;
  }
  return total;
}

/** 始業から指定時刻までの正味稼働時間（分）。稼働時間（H）を上限にする。 */
export function netWorkedMinutes(line: CapacityShape, time: string): number {
  const startMin = timeToMinutes(line.startTime) ?? 0;
  const elapsed = minutesFromStart(startMin, time);
  const net = elapsed - breakMinutesUntil(line.startTime, line.breaks, time);
  const capacityMinutes = Math.max(0, line.workHours * 60);
  return Math.max(0, Math.min(net, capacityMinutes));
}

/** 時間当たりの出来高（ライン実力 ÷ 稼働時間）。 */
export function hourlyRate(line: CapacityShape): number {
  if (line.workHours <= 0) return 0;
  return line.capacityPerDay / line.workHours;
}

/**
 * 指定時刻時点の理論値。
 * plannedQty（本日の計画数）を渡すとそれを上限にする（計画以上に「出来ているはず」とは言わない）。
 */
export function theoreticalAt(
  line: CapacityShape,
  time: string,
  plannedQty?: number
): number {
  // netWorkedMinutes が稼働時間（H）で頭打ちになるため、raw は自然にライン実力を超えない。
  // 計画数が実力より少ない日は、計画数を上限にする。
  const raw = (hourlyRate(line) * netWorkedMinutes(line, time)) / 60;
  const capped = plannedQty && plannedQty > 0 ? Math.min(raw, plannedQty) : raw;
  return Math.round(capped);
}

/** 終業時刻（始業＋稼働時間＋休憩合計）。表示用。 */
export function endTimeOf(line: CapacityShape): string {
  const startMin = timeToMinutes(line.startTime) ?? 0;
  const total = startMin + line.workHours * 60 + totalBreakMinutes(line.breaks);
  const m = Math.round(((total % 1440) + 1440) % 1440);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 1日の正味稼働時間（人時計算の分母）＝ 稼働時間（H）。 */
export function plannedManHoursOf(workHours: number, headcount: number): number {
  return Math.max(0, workHours) * Math.max(0, headcount);
}

/** 不足を取り戻すのに必要な残業時間（分）の目安。実力が0なら null。 */
export function suggestOvertimeMinutes(line: CapacityShape, gap: number): number | null {
  if (gap <= 0) return 0;
  const rate = hourlyRate(line);
  if (rate <= 0) return null;
  // 5分単位に切り上げる（実務の申請単位に合わせる）
  return Math.ceil(((gap / rate) * 60) / 5) * 5;
}

/** "10:00-10:10, 12:10-12:50／14:50-15:00" のような入力を BreakSpan[] に整える。 */
export function parseBreaks(raw: string): BreakSpan[] {
  const out: BreakSpan[] = [];
  const re = /(\d{1,2}):(\d{2})\s*[-−~〜–—]\s*(\d{1,2}):(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const start = `${m[1].padStart(2, "0")}:${m[2]}`;
    const end = `${m[3].padStart(2, "0")}:${m[4]}`;
    if (timeToMinutes(start) === null || timeToMinutes(end) === null) continue;
    out.push({ start, end });
  }
  return out;
}

/** BreakSpan[] を "10:00-10:10／12:10-12:50" 表記にする。 */
export function formatBreaks(breaks: BreakSpan[]): string {
  return breaks.map((b) => `${b.start}-${b.end}`).join("／");
}
