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
  };
}

/** 社員番号（login_id）でユーザーを引く。無ければ null。 */
export async function findUserByLoginId(loginId: string): Promise<AppUser | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, login_id, name, email, role, factory, department
    FROM op_users WHERE login_id = ${loginId} LIMIT 1`;
  return rows[0] ? toUser(rows[0] as Record<string, unknown>) : null;
}

/** ID でユーザーを引く（役割の最新値を JWT ではなく DB から取るために使う）。 */
export async function findUserById(id: string): Promise<AppUser | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, login_id, name, email, role, factory, department
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
  const rows = await sql`
    INSERT INTO op_users (login_id, name, email, role, factory, department)
    VALUES (${input.loginId}, ${input.name}, ${input.email ?? null}, ${role},
            ${input.factory ?? null}, ${input.department ?? null})
    ON CONFLICT (login_id) DO UPDATE SET
      name       = EXCLUDED.name,
      email      = COALESCE(EXCLUDED.email, op_users.email),
      role       = EXCLUDED.role,
      factory    = COALESCE(EXCLUDED.factory, op_users.factory),
      department = COALESCE(EXCLUDED.department, op_users.department),
      updated_at = now()
    RETURNING id, login_id, name, email, role, factory, department, (xmax = 0) AS inserted`;
  const row = rows[0] as Record<string, unknown>;
  return { user: toUser(row), created: row.inserted === true };
}
