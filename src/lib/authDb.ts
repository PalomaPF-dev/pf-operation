import { getSql } from "./neon";
import { ensureSchema } from "./schema";

/** ポータルから連携される役割。管理者だけがこのアプリを利用できる。 */
export type UserRole = "admin" | "member";

export interface AppUser {
  id: string;
  loginId: string;
  name: string;
  email: string | null;
  role: UserRole;
  factory: string | null;
  /** ポータルの所属部署名。マスタを編集できる部署かどうかの判定に使う */
  department: string | null;
  /** ポータルの管理権限（can_manage）。部署によらずマスタを編集できる */
  portalAdmin: boolean;
  /** 上長（残業申請の承認者）。利用者マスタで設定する */
  approverId: string | null;
}

function toRole(v: unknown): UserRole {
  return v === "admin" ? "admin" : "member";
}

function toUser(row: Record<string, unknown>): AppUser {
  return {
    id: String(row.id),
    loginId: String(row.login_id),
    name: String(row.name ?? ""),
    email: (row.email as string | null) ?? null,
    role: toRole(row.role),
    factory: (row.factory as string | null) ?? null,
    department: (row.department as string | null) ?? null,
    portalAdmin: row.portal_admin === true,
    approverId: (row.approver_id as string | null) ?? null,
  };
}

/** 社員番号（login_id）でユーザーを引く。無ければ null。 */
export async function findUserByLoginId(loginId: string): Promise<AppUser | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, login_id, name, email, role, factory, department, portal_admin, approver_id
    FROM op_users WHERE login_id = ${loginId} LIMIT 1`;
  return rows[0] ? toUser(rows[0] as Record<string, unknown>) : null;
}

/** ID でユーザーを引く（役割の最新値を JWT ではなく DB から取るために使う）。 */
export async function findUserById(id: string): Promise<AppUser | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, login_id, name, email, role, factory, department, portal_admin, approver_id
    FROM op_users WHERE id = ${id} LIMIT 1`;
  return rows[0] ? toUser(rows[0] as Record<string, unknown>) : null;
}

export interface PortalUserInput {
  loginId: string;
  name: string;
  email?: string | null;
  role?: UserRole;
  factory?: string | null;
  department?: string | null;
  /** ポータルの管理権限。null（未指定）なら既存値を保つ */
  portalAdmin?: boolean | null;
}

/**
 * ポータル由来のユーザーを作成／更新する（プロビジョニングと SSO で共用）。
 * 氏名・役割・所属工場はポータルを正とし、毎回上書きする（役割変更が即時に効く）。
 * 戻り値の created は新規作成かどうか。
 */
export async function upsertPortalUser(
  input: PortalUserInput
): Promise<{ user: AppUser; created: boolean }> {
  await ensureSchema();
  const sql = getSql();
  const role = toRole(input.role);
  // portalAdmin は「送られてこなければ現状維持」。null を渡して COALESCE で既存値に落とす
  // （provision API はこの値を持たないため、SSO で立った権限を消さないようにする）。
  const portalAdmin = input.portalAdmin ?? null;
  const rows = await sql`
    INSERT INTO op_users (login_id, name, email, role, factory, department, portal_admin)
    VALUES (${input.loginId}, ${input.name}, ${input.email ?? null}, ${role},
            ${input.factory ?? null}, ${input.department ?? null},
            COALESCE(${portalAdmin}::boolean, false))
    ON CONFLICT (login_id) DO UPDATE SET
      name         = EXCLUDED.name,
      email        = COALESCE(EXCLUDED.email, op_users.email),
      role         = EXCLUDED.role,
      factory      = COALESCE(EXCLUDED.factory, op_users.factory),
      department   = COALESCE(EXCLUDED.department, op_users.department),
      portal_admin = COALESCE(${portalAdmin}::boolean, op_users.portal_admin),
      updated_at   = now()
    RETURNING id, login_id, name, email, role, factory, department, portal_admin, approver_id, (xmax = 0) AS inserted`;
  const row = rows[0] as Record<string, unknown>;
  return { user: toUser(row), created: row.inserted === true };
}

/**
 * 承認者（上長）用のユーザー行を確保する。
 * まだログインしていない上長でも承認ルートに指定できるよう、最小限の行だけ作る
 * （role は 'member' で作り、本人が SSO したときにポータルの値で上書きされる）。
 * 既に居る場合は何も変えず、その行を返す。
 */
export async function ensureUserStub(loginId: string, name: string): Promise<AppUser> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO op_users (login_id, name, role)
    VALUES (${loginId}, ${name}, 'member')
    ON CONFLICT (login_id) DO UPDATE SET login_id = EXCLUDED.login_id
    RETURNING id, login_id, name, email, role, factory, department, portal_admin, approver_id`;
  return toUser(rows[0] as Record<string, unknown>);
}

/**
 * ポータルの承認者（上司）設定を反映する。ポータルを正として毎回上書きする。
 * approverLoginId が null なら未設定（申請は生産管理部宛て）。自分自身は設定しない。
 */
export async function syncApproverFromPortal(
  user: AppUser,
  approverLoginId: string | null,
  approverName: string | null
): Promise<void> {
  let approverId: string | null = null;
  if (approverLoginId && approverLoginId !== user.loginId) {
    const approver = await ensureUserStub(approverLoginId, approverName ?? approverLoginId);
    approverId = approver.id;
  }
  if (approverId === user.approverId) return;
  const sql = getSql();
  await sql`
    UPDATE op_users SET approver_id = ${approverId}, updated_at = now()
    WHERE id = ${user.id}`;
}

/**
 * 翌日回しの許可を出せる人（生産管理部の管理者・ポータル管理権限者）の社員番号。
 * 許可待ちの通知先に使う。判定は canEditMaster（src/lib/session.ts）と同じ条件。
 */
export async function listMasterEditorLoginIds(departments: string[]): Promise<string[]> {
  const sql = getSql();
  const rows = (await sql`
    SELECT login_id FROM op_users
    WHERE role = 'admin'
      AND (portal_admin = true OR department = ANY(${departments}::text[]))
    ORDER BY login_id`) as { login_id: string }[];
  return rows.map((r) => String(r.login_id)).filter(Boolean);
}

/**
 * ある工場に所属する管理者の社員番号。許可・差し戻しの通知先に使う。
 * ポータルでは工場が部署として登録されるため、factory と department の両方を突き合わせる
 * （入力範囲の判定 getUserScope と同じ考え方）。
 */
export async function listFactoryMemberLoginIds(factoryName: string): Promise<string[]> {
  if (!factoryName) return [];
  const sql = getSql();
  const rows = (await sql`
    SELECT login_id FROM op_users
    WHERE role = 'admin' AND (factory = ${factoryName} OR department = ${factoryName})
    ORDER BY login_id`) as { login_id: string }[];
  return rows.map((r) => String(r.login_id)).filter(Boolean);
}

/** 社員番号を ID から引く（通知先の組み立て用）。 */
export async function findLoginIdById(id: string): Promise<string | null> {
  const sql = getSql();
  const rows = (await sql`SELECT login_id FROM op_users WHERE id = ${id} LIMIT 1`) as {
    login_id: string;
  }[];
  return rows[0] ? String(rows[0].login_id) : null;
}
