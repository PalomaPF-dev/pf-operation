import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { listReportParticipantLoginIds } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 報告ごとの連絡欄（チャット）の中継。
 *
 * 本体はポータルにある（履歴もAPIも全アプリで共有する。docs は pf-portal の docs/chat.md）。
 * このアプリとポータルは別ドメインのため、画面から直接ポータルを呼んでもログイン cookie が
 * 送られず「誰の発言か」を確定できない。そこでここで中継し、発言者の社員番号は
 * next-auth のセッションから入れる（クライアントの申告は一切使わない）。
 *
 * PF_PROVISION_KEY はサーバー側だけで扱う。ブラウザへ出すと誰でも任意の社員番号で
 * 発言できてしまうため、レスポンスにも含めない。
 */

const PORTAL_CHAT_URL = `${(process.env.PORTAL_ORIGIN ?? "https://portal.paloma-pf.com").replace(/\/+$/, "")}/api/chat`;
// ポータル側のアプリキー。クライアントから渡させると他アプリのスレッドを読み書きできてしまう
const APP_KEY = "operation";
const ALLOWED_ACTIONS = new Set(["list", "post", "read", "unread"]);
const FETCH_TIMEOUT_MS = 10000;

export async function POST(req: Request): Promise<Response> {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.json({ message: "ログインが必要です" }, { status: 401 });
  }
  const key = (process.env.PF_PROVISION_KEY ?? "").trim();
  if (!key) {
    return NextResponse.json({ message: "サーバー設定が未完了です（PF_PROVISION_KEY）" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "リクエストが不正です" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "post";
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ message: "action が不正です" }, { status: 400 });
  }
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (action !== "unread" && !ref) {
    return NextResponse.json({ message: "ref を指定してください" }, { status: 400 });
  }

  // 関係者（申請者・承認者）はDBから引く。クライアントから受け取ると、
  // 無関係な人を参加者に加えて通知を飛ばせてしまう。
  let participants: string[] = [];
  if (action === "post") {
    try {
      participants = await listReportParticipantLoginIds(ref);
    } catch (e) {
      console.error("[chat] participants lookup failed:", e);
    }
  }

  const payload = {
    key,
    loginId: session.loginId,
    app: APP_KEY,
    action,
    ref,
    title: typeof body.title === "string" ? body.title.slice(0, 200) : "",
    message: typeof body.message === "string" ? body.message : undefined,
    url: typeof body.url === "string" ? body.url : undefined,
    participants,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(PORTAL_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await r.json().catch(() => null);
    return NextResponse.json(data ?? { message: "ポータルから応答がありません" }, { status: r.status });
  } catch (e) {
    console.error("[chat] portal request failed:", e);
    return NextResponse.json({ message: "連絡欄の取得に失敗しました" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
