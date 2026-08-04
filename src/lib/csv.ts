/** CSV 生成（Excel で文字化けしないよう UTF-8 BOM 付き・CRLF 改行）。 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // 先頭が = + - @ のセルは Excel が数式として解釈するため、' を前置して無害化する
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(escapeCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** CSV をダウンロードさせる Response。 */
export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
