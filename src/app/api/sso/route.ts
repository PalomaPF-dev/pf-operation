import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { encode } from "next-auth/jwt";
import { upsertPortalUser } from "@/lib/authDb";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE, useSecureCookies } from "@/lib/authOptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ポータルからの SSO ログイン API（このアプリ唯一のログイン経路）。
 * ポータルが発行した短命トークン（HMAC-SHA256署名・60秒有効）を検証し、
 * パスワード入力なしで next-auth の JWT セッションを発行して "/" へ遷移する。
 * トークン: base64url(JSON{loginId, name, role, app, exp}) + "." + hex(HMAC-SHA256(payload, PF_PROVISION_KEY))
 *
 * 管理者専用アプリのため、role が 'admin' でないユーザーはここで弾く。
 */

// このアプリのキー（ポータル側の app 指定と一致する必要がある）
const APP_KEY = "operation";

/** タイミング安全な比較（長さ違いは即 false）。 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface SsoClaims {
  loginId: string;
  name: string;
  role: "admin" | "member";
  factory: string | null;
  /** ポータルの所属部署名。マスタ編集の可否判定に使う（ポータルが送らなければ null） */
  department: string | null;
  /** ポータルの管理権限（canManage）。部署によらずマスタを編集できる */
  portalAdmin: boolean;
}

/** トークンを検証し、有効なら中身を返す（無効は null）。 */
function verifySsoToken(token: string, key: string): SsoClaims | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", key).update(payload).digest("hex");
  if (!safeEqual(sig, expected)) return null;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { loginId, name, role, factory, department, canManage, app, exp } = data as Record<
    string,
    unknown
  >;
  if (typeof loginId !== "string" || loginId.length === 0) return null;
  if (app !== APP_KEY) return null;
  if (typeof exp !== "number" || !(exp > Date.now())) return null;
  return {
    loginId,
    name: typeof name === "string" && name ? name : loginId,
    role: role === "admin" ? "admin" : "member",
    factory: typeof factory === "string" && factory ? factory : null,
    department: typeof department === "string" && department ? department : null,
    portalAdmin: canManage === true,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // 失敗時は詳細を漏らさずログイン画面へ（302）
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, url), 302);

  const key = process.env.PF_PROVISION_KEY;
  if (!key) return new NextResponse("SSO is not configured", { status: 503 });

  const token = url.searchParams.get("token");
  if (!token) return fail("sso");
  const claims = verifySsoToken(token, key);
  if (!claims) return fail("sso");

  try {
    // 役割が変わっていてもポータルを正として毎回反映する。
    // ここは DB を触る最初の処理なので、DATABASE_URL の設定ミスはここで表面化する。
    // 原因が画面から分かるよう、DB の失敗だけは専用のエラーコードで返す。
    let user;
    try {
      ({ user } = await upsertPortalUser({
        loginId: claims.loginId,
        name: claims.name,
        role: claims.role,
        factory: claims.factory,
        department: claims.department,
        portalAdmin: claims.portalAdmin,
      }));
    } catch (e) {
      console.error("[sso] database:", e);
      return fail("db");
    }

    // 管理者専用。一般ユーザーはセッションを発行しない
    if (user.role !== "admin") return fail("forbidden");

    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) return fail("config");

    const jwt = await encode({
      token: {
        name: user.name,
        email: user.email ?? null,
        sub: user.id,
        id: user.id,
        loginId: user.loginId,
        role: user.role,
        factory: user.factory,
      },
      secret,
      maxAge: SESSION_MAX_AGE,
    });

    const res = NextResponse.redirect(new URL("/", url), 302);
    res.cookies.set(SESSION_COOKIE_NAME, jwt, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: useSecureCookies,
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (e) {
    console.error("[sso]", e);
    return fail("server");
  }
}
