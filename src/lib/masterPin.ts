import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

/**
 * マスタ編集の PIN ロック。
 *
 * ライン実力・稼働時間は工場をまたいで効く前提値なので、閲覧は誰でも（管理者なら）できるが、
 * 編集は PIN を通したときだけにする。解除は HttpOnly cookie（既定2時間）で保持する。
 * PIN は環境変数 MASTER_EDIT_PIN。未設定ならロックは無効（＝編集できる）。
 */

const COOKIE_NAME = "op_master_unlock";
const UNLOCK_HOURS = 2;

function secret(): string {
  return (process.env.NEXTAUTH_SECRET ?? "").trim();
}

/** PIN が設定されているか（未設定ならロックしない）。 */
export function pinConfigured(): boolean {
  return (process.env.MASTER_EDIT_PIN ?? "").trim().length > 0;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 入力された PIN が正しいか。 */
export function verifyPin(pin: string): boolean {
  const expected = (process.env.MASTER_EDIT_PIN ?? "").trim();
  if (!expected) return true;
  return safeEqual(pin.trim(), expected);
}

/** 解除 cookie を発行する（PIN 検証に成功したあとに呼ぶ）。 */
export async function setUnlockCookie(): Promise<void> {
  const exp = Date.now() + UNLOCK_HOURS * 60 * 60 * 1000;
  const value = `${exp}.${sign(String(exp))}`;
  const store = await cookies();
  store.set(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: UNLOCK_HOURS * 60 * 60,
  });
}

export async function clearUnlockCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

/** いま編集できる状態か。PIN 未設定なら常に true。 */
export async function isMasterUnlocked(): Promise<boolean> {
  if (!pinConfigured()) return true;
  if (!secret()) return false;
  const value = (await cookies()).get(COOKIE_NAME)?.value;
  if (!value) return false;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return false;
  const exp = Number(value.slice(0, dot));
  const mac = value.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(mac, sign(String(exp)));
}

/** 編集系の Server Action の入口。ロック中なら例外にする。 */
export async function requireMasterUnlocked(): Promise<void> {
  if (!(await isMasterUnlocked())) {
    throw new Error("マスタの編集にはPINの入力が必要です");
  }
}
