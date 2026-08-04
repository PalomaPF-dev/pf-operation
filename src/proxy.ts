import { NextResponse } from "next/server";

/**
 * 認証済みページ（工場横断の操業データを描画）向けのセキュリティ強化。
 * Next.js 16 で middleware は proxy に改名されたため、この名前で置く。
 *
 * - Cache-Control: 共有キャッシュ/CDN への滞留を防ぐ（force-dynamic で元々非キャッシュだが明示）。
 * - クリックジャッキング/MIMEスニッフィング/リファラ漏洩への基本的な防御ヘッダ。
 */
export function proxy() {
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = {
  matcher: ["/", "/report", "/reports", "/summary", "/masters"],
};
