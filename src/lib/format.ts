/** 表示用のフォーマッタ（日本時間・日本語表記に統一）。 */

const JST = "Asia/Tokyo";

/** Date | string を "YYYY-MM-DD"（JST）にする。 */
export function toDateString(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: JST }).format(d);
}

/** 今日（JST）の "YYYY-MM-DD"。 */
export function todayString(): string {
  return toDateString(new Date());
}

/** 当月初日（JST）の "YYYY-MM-DD"。 */
export function monthStartString(): string {
  return `${todayString().slice(0, 7)}-01`;
}

/** "YYYY-MM-DD" に日数を足す（負なら遡る）。 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return toDateString(d);
}

/**
 * "YYYY-MM-DD" → "M/D(曜)"。
 *
 * 曜日は日付そのものから出す。JST の 0:00 は UTC では前日の 15:00 になるため、
 * getUTCDay() を使うと曜日が1日ずれる（8/7(金) が木と出ていた）。
 */
export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  // UTC 正午で作れば、どのタイムゾーンで解釈してもその日のままになる
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  const week = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  return `${Number(m[2])}/${Number(m[3])}(${week})`;
}

/** timestamptz → "M/D HH:MM"。 */
export function formatDateTime(value: Date | string | null): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Postgres の time 型（"HH:MM:SS"）を "HH:MM" に詰める。 */
export function formatTime(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 5);
}

/** 分 → "1.5h"（小数第1位、端数無しなら整数）。 */
export function formatHours(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/** 人時（小数）を "12.5" 形式に。 */
export function formatManHours(hours: number): string {
  return hours.toFixed(1);
}

/** 数値を桁区切りで。 */
export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 比率（0.95）を "95.0%" に。null は "—"。 */
export function formatPercent(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}

/** "HH:MM" / "HH:MM:SS" を 0時からの分に。不正値は null。 */
export function timeToMinutes(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** いま（JST）の 0時からの分。定期報告の「もう過ぎた時刻」の判定に使う。 */
export function nowJstMinutes(): number {
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: JST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
  return timeToMinutes(hhmm) ?? 0;
}

/** 0時からの分を "HH:MM" に。 */
export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
