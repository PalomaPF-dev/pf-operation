import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { syncApproverFromPortal, upsertPortalUser } from "@/lib/authDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ポータルからの一括アカウント連携 API（内部用・UIなし）。
 * 認証はセッションではなく共有キー PF_PROVISION_KEY（未設定なら 503 で無効化）。
 *
 * このアプリはポータル SSO 専用（アプリ単独のパスワードを持たない）ため、
 * 招待リンクは発行せず inviteUrl は返さない。passwordSet は常に true（＝パスワード設定待ちではない）。
 * 一般ユーザー（role='member'）も台帳としては登録するが、SSO 時に弾かれてログインはできない。
 */

const MAX_USERS_PER_REQUEST = 200;
const isLoginId = (s: string) => /^[A-Za-z0-9_-]{1,64}$/.test(s);

function safeKeyEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type ProvisionResult = {
  loginId: string;
  status: "created" | "exists" | "error";
  passwordSet?: boolean;
  message?: string;
};

export async function POST(req: Request) {
  const provisionKey = process.env.PF_PROVISION_KEY;
  if (!provisionKey) {
    return NextResponse.json({ message: "provision未設定" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : "";
  if (!safeKeyEqual(key, provisionKey)) {
    return NextResponse.json({ message: "認証に失敗しました。" }, { status: 401 });
  }

  const users = body.users;
  if (!Array.isArray(users) || users.length === 0) {
    return NextResponse.json({ message: "users を指定してください。" }, { status: 400 });
  }
  if (users.length > MAX_USERS_PER_REQUEST) {
    return NextResponse.json(
      { message: `一度に発行できるのは最大${MAX_USERS_PER_REQUEST}件です。` },
      { status: 400 }
    );
  }

  const results: ProvisionResult[] = [];
  for (const u of users) {
    const loginId = typeof u?.loginId === "string" ? u.loginId.trim() : "";
    const name = typeof u?.name === "string" ? u.name.trim() : "";
    if (!isLoginId(loginId) || !name) {
      results.push({ loginId, status: "error", message: "社員番号・氏名が不正です。" });
      continue;
    }
    try {
      const { user, created } = await upsertPortalUser({
        loginId,
        name,
        email: typeof u?.email === "string" ? u.email.trim() : null,
        role: u?.role === "admin" ? "admin" : "member",
        factory: typeof u?.factory === "string" ? u.factory.trim() : null,
        // 所属部署。マスタを編集できるかの判定に使う（ポータルが送らなければ SSO 時に補われる）
        department: typeof u?.department === "string" ? u.department.trim() : null,
        // ポータル管理権限。項目が無い旧ポータルからは null（既存値を保つ）
        portalAdmin: typeof u?.canManage === "boolean" ? u.canManage : null,
      });
      // ポータルの承認者（上司）設定。項目があるときだけ反映する
      if (u && "approverLoginId" in u) {
        const a = u.approverLoginId;
        await syncApproverFromPortal(user, typeof a === "string" && a ? a : null, null);
      }
      results.push({ loginId, status: created ? "created" : "exists", passwordSet: true });
    } catch (e) {
      console.error("[provision]", loginId, e);
      results.push({ loginId, status: "error", message: "登録に失敗しました。" });
    }
  }

  return NextResponse.json({ results });
}
