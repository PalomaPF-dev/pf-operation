import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { authOptions } from "./authOptions";
import { findUserById } from "./authDb";

export interface AppSession {
  userId: string;
  loginId: string;
  userName: string;
  /** 所属工場（ポータル連携値）。表示の初期値に使うだけで、閲覧範囲は絞らない */
  factory: string | null;
  /** 所属部署（ポータル連携値）。マスタ編集の可否判定に使う */
  department: string | null;
  /** ポータルの管理権限を持つか（部署によらずマスタを編集できる） */
  portalAdmin: boolean;
  /** 上長（残業申請の承認者）。利用者マスタで設定。null なら申請は生産管理部宛て */
  approverId: string | null;
  /** マスタ（工場・ライン・作業者）を編集できるか */
  canEditMaster: boolean;
}

/**
 * マスタを編集できる部署。
 * 既定は「生産管理部」。環境変数 MASTER_EDIT_DEPARTMENTS でカンマ区切りで変更できる。
 */
export function masterEditDepartments(): string[] {
  const raw = (process.env.MASTER_EDIT_DEPARTMENTS ?? "生産管理部").trim();
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * このアプリに入れるか（進捗管理は管理者専用）。
 * - ポータルの役割が管理者（role='admin'）
 * - または ポータル管理権限を持つ人（portal_admin＝ポータルの can_manage）
 *
 * ポータル側の起動判定（role==='admin' || canManage）と揃えてある。揃えないと、
 * ポータルではタイルを押せるのにアプリ側で forbidden になる（人事管理も同じ規則）。
 */
export function canEnterOperation(user: { role: string; portalAdmin: boolean }): boolean {
  return user.role === "admin" || user.portalAdmin === true;
}

/**
 * マスタを編集できるか。
 * - ポータルの管理権限を持つ人（ポータル管理者）は、部署によらず編集できる。
 * - それ以外は所属部署が MASTER_EDIT_DEPARTMENTS に含まれる場合のみ（部署未連携は編集不可）。
 */
function canEditMaster(user: { department: string | null; portalAdmin: boolean }): boolean {
  if (user.portalAdmin) return true;
  if (!user.department) return false;
  return masterEditDepartments().includes(user.department);
}

/**
 * セッションを読む。設定不備（NEXTAUTH_SECRET 未設定など）で next-auth が例外を投げたときは、
 * 素の 500 を返さずに configError として扱い、ログイン画面で理由を案内する。
 */
async function readSession(): Promise<{ session: Session | null; configError: boolean }> {
  try {
    return { session: await getServerSession(authOptions), configError: false };
  } catch (e) {
    console.error("[session] getServerSession failed:", e);
    return { session: null, configError: true };
  }
}

/**
 * 管理者セッションを要求する（このアプリの全ページ・全 Server Action の入口）。
 *
 * 進捗管理は「管理者だけが使うアプリ」。ポータルの役割（role）が admin のユーザー以外は
 * ログインもできないが、権限を外された直後の既存セッションを弾くため、
 * ここで毎回 DB の role を確認する（JWT の値は信用しない）。
 */
export async function requireAdminSession(): Promise<AppSession> {
  const { session, configError } = await readSession();
  if (configError) redirect("/login?error=config");
  if (!session?.user?.id) redirect("/login");
  const user = await findUserById(session.user.id);
  if (!user) redirect("/login?error=account");
  if (!canEnterOperation(user)) redirect("/login?error=forbidden");
  return {
    userId: user.id,
    loginId: user.loginId,
    userName: user.name,
    factory: user.factory,
    department: user.department,
    portalAdmin: user.portalAdmin,
    approverId: user.approverId,
    canEditMaster: canEditMaster(user),
  };
}

/**
 * マスタの編集を要求する（マスタ系 Server Action の入口）。
 * 管理者であることに加えて、所属部署が編集可能な部署（既定：生産管理部）であること。
 * 画面側でもボタンを出さないが、サーバー側でも必ず防ぐ。
 */
export async function requireMasterEditor(): Promise<AppSession> {
  const s = await requireAdminSession();
  if (!s.canEditMaster) {
    throw new Error(
      `マスタを編集できるのは${masterEditDepartments().join("・")}の管理者、` +
        "またはポータル管理権限を持つ管理者のみです"
    );
  }
  return s;
}

/** リダイレクトせず null を返す版（API route で 401 を返したいとき用）。 */
export async function getAdminSession(): Promise<AppSession | null> {
  const { session } = await readSession();
  if (!session?.user?.id) return null;
  const user = await findUserById(session.user.id);
  if (!user || !canEnterOperation(user)) return null;
  return {
    userId: user.id,
    loginId: user.loginId,
    userName: user.name,
    factory: user.factory,
    department: user.department,
    portalAdmin: user.portalAdmin,
    approverId: user.approverId,
    canEditMaster: canEditMaster(user),
  };
}
