import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./authOptions";
import { findUserById } from "./authDb";

export interface AppSession {
  userId: string;
  loginId: string;
  userName: string;
  /** 所属工場（ポータル連携値）。表示の初期値に使うだけで、閲覧範囲は絞らない */
  factory: string | null;
}

/**
 * 管理者セッションを要求する（このアプリの全ページ・全 Server Action の入口）。
 *
 * 進捗管理は「管理者だけが使うアプリ」。ポータルの役割（role）が admin のユーザー以外は
 * ログインもできないが、権限を外された直後の既存セッションを弾くため、
 * ここで毎回 DB の role を確認する（JWT の値は信用しない）。
 */
export async function requireAdminSession(): Promise<AppSession> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  const user = await findUserById(session.user.id);
  if (!user) redirect("/login?error=account");
  if (user.role !== "admin") redirect("/login?error=forbidden");
  return {
    userId: user.id,
    loginId: user.loginId,
    userName: user.name,
    factory: user.factory,
  };
}

/** リダイレクトせず null を返す版（API route で 401 を返したいとき用）。 */
export async function getAdminSession(): Promise<AppSession | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const user = await findUserById(session.user.id);
  if (!user || user.role !== "admin") return null;
  return {
    userId: user.id,
    loginId: user.loginId,
    userName: user.name,
    factory: user.factory,
  };
}
