"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession } from "./session";
import {
  clearUnlockCookie,
  requireMasterUnlocked,
  setUnlockCookie,
  verifyPin,
} from "./masterPin";
import {
  createFactory,
  createLine,
  createWorker,
  deleteFactory,
  deleteLine,
  deleteReport,
  deleteWorker,
  getLine,
  saveReport,
  updateFactory,
  updateLine,
  updateLineCapacity,
  updateWorker,
  upsertPlan,
} from "./db";
import { parseBreaks, theoreticalAt } from "./capacity";
import {
  isLineType,
  isOvertimeDecision,
  isProgressStatus,
  isReasonCode,
  isReportKind,
  type OvertimeDecision,
  type ProgressStatus,
  type ReasonCode,
  type ReportKind,
} from "./types";
import { timeToMinutes } from "./format";

/* ===== FormData の読み取り（不正値は既定値に丸める） ===== */

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function optStr(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === "" ? null : v;
}

function int(fd: FormData, key: string, fallback = 0): number {
  const n = Number(str(fd, key));
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function dec(fd: FormData, key: string, fallback = 0): number {
  const n = Number(str(fd, key));
  return Number.isFinite(n) ? n : fallback;
}

function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

/** "HH:MM" として妥当なら返す。不正なら fallback。 */
function time(fd: FormData, key: string, fallback: string): string {
  const v = str(fd, key);
  return timeToMinutes(v) === null ? fallback : v.slice(0, 5);
}

/* ===== 定期報告（進捗チェック／終業後） ===== */

/** 対象者の選択（worker_<workerId> のチェックと minutes_<workerId>）を読み取る。 */
function readMembers(fd: FormData): { workerId: string; minutes: number }[] {
  const out: { workerId: string; minutes: number }[] = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("worker_")) continue;
    if (value !== "on" && value !== "true") continue;
    const workerId = key.slice("worker_".length);
    const raw = fd.get(`minutes_${workerId}`);
    const minutes = Math.round(Number(typeof raw === "string" ? raw : 0));
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    out.push({ workerId, minutes });
  }
  return out;
}

/**
 * 進捗と残業の要否をまとめて登録する。
 *
 * 理論値はクライアントから送られた値をそのまま信じず、マスタ（ライン実力・稼働時間・休憩）と
 * 始業・チェック時刻からサーバー側で計算し直して保存する。
 */
export async function saveReportAction(fd: FormData): Promise<void> {
  const session = await requireAdminSession();

  const lineId = str(fd, "lineId");
  const reportDate = str(fd, "reportDate");
  if (!lineId || !reportDate) throw new Error("ラインと日付を指定してください");

  const line = await getLine(lineId);
  if (!line) throw new Error("ラインが見つかりません");

  const kindRaw = str(fd, "kind");
  const kind: ReportKind = isReportKind(kindRaw) ? kindRaw : "checkpoint";
  const startTime = time(fd, "startTime", line.startTime);
  const reportTime = time(fd, "reportTime", startTime);
  const plannedQty = Math.max(0, int(fd, "plannedQty"));
  const actualQty = Math.max(0, int(fd, "actualQty"));
  const headcount = Math.max(0, dec(fd, "headcount", line.headcount));

  const statusRaw = str(fd, "progressStatus");
  const progressStatus: ProgressStatus = isProgressStatus(statusRaw) ? statusRaw : "ontrack";
  const decisionRaw = str(fd, "overtimeDecision");
  const overtimeDecision: OvertimeDecision = isOvertimeDecision(decisionRaw)
    ? decisionRaw
    : "none";
  const reasonCodeRaw = str(fd, "reasonCode");
  const reasonCode: ReasonCode | null = isReasonCode(reasonCodeRaw) ? reasonCodeRaw : null;
  const reason = optStr(fd, "reason");

  // 前工程は「残業が必要な理由」を必ず残す（画面側の申告ではなく DB のライン種別で判定する）
  if (line.lineType === "process" && overtimeDecision === "do" && !reason) {
    throw new Error("前工程で残業を実施する場合は、理由の記載が必要です");
  }
  const members = readMembers(fd);
  if (overtimeDecision === "do" && members.length === 0) {
    throw new Error("残業を実施する場合は、対象者と時間を1名以上入力してください");
  }

  // 計画数・始業・投入人数はその日の計画として保持する（集計の分母になる）
  const planId = await upsertPlan(lineId, reportDate, {
    plannedQty,
    startTime,
    headcount,
    note: null,
  });

  // 理論値はマスタ（ライン実力・稼働時間・休憩）から計算し直す。
  // 終業後の報告でも同じ式でよい（正味稼働時間が稼働時間Hで頭打ちになるため）。
  const theoreticalQty = theoreticalAt({ ...line, startTime }, reportTime, plannedQty);

  await saveReport(
    {
      lineId,
      planId,
      reportDate,
      kind,
      reportTime,
      startTime,
      plannedQty,
      theoreticalQty,
      actualQty,
      progressStatus,
      overtimeDecision,
      reasonCode,
      reason,
      note: optStr(fd, "note"),
      members,
    },
    session.userId
  );

  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath("/summary");
  redirect(`/report?line=${encodeURIComponent(lineId)}&date=${encodeURIComponent(reportDate)}&saved=1`);
}

export async function deleteReportAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  const id = str(fd, "id");
  if (!id) return;
  await deleteReport(id);
  revalidatePath("/");
  revalidatePath("/reports");
  revalidatePath("/summary");
}

/* ===== マスタ：PIN ロック ===== */

export async function unlockMasterAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  const pin = str(fd, "pin");
  if (!verifyPin(pin)) throw new Error("PINが違います");
  await setUnlockCookie();
  revalidatePath("/masters");
}

export async function lockMasterAction(): Promise<void> {
  await requireAdminSession();
  await clearUnlockCookie();
  revalidatePath("/masters");
}

/* ===== マスタ：工場 ===== */

export async function saveFactoryAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  await requireMasterUnlocked();
  const id = optStr(fd, "id");
  const name = str(fd, "name");
  if (!name) throw new Error("工場名を入力してください");
  const sortOrder = int(fd, "sortOrder");
  if (id) await updateFactory(id, name, sortOrder);
  else await createFactory(name, sortOrder);
  revalidatePath("/masters");
}

export async function deleteFactoryAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  await requireMasterUnlocked();
  const id = str(fd, "id");
  if (!id) return;
  await deleteFactory(id);
  revalidatePath("/masters");
}

/* ===== マスタ：ライン ===== */

function readLineInput(fd: FormData) {
  const factoryId = str(fd, "factoryId");
  const name = str(fd, "name");
  if (!factoryId || !name) throw new Error("工場とライン名を入力してください");
  const lineTypeRaw = str(fd, "lineType");
  return {
    factoryId,
    name,
    lineType: isLineType(lineTypeRaw) ? lineTypeRaw : ("assembly" as const),
    capacityPerDay: Math.max(0, dec(fd, "capacityPerDay")),
    workHours: Math.max(0, dec(fd, "workHours", 8)),
    startTime: time(fd, "startTime", "08:00"),
    breaks: parseBreaks(str(fd, "breaks")),
    headcount: Math.max(0, dec(fd, "headcount")),
    note: optStr(fd, "note"),
    active: bool(fd, "active"),
    sortOrder: int(fd, "sortOrder"),
  };
}

export async function saveLineAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  await requireMasterUnlocked();
  const id = optStr(fd, "id");
  const input = readLineInput(fd);
  if (id) await updateLine(id, input);
  else await createLine(input);
  revalidatePath("/masters");
  revalidatePath("/report");
}

/**
 * ライン実力・稼働時間・備考だけをまとめて直す（マスタ一覧の表からの更新）。
 * 1つの工場ぶんを1回の送信で保存する。
 */
export async function saveCapacitiesAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  await requireMasterUnlocked();
  const ids = fd.getAll("lineId").filter((v): v is string => typeof v === "string");
  for (const id of ids) {
    const capacityRaw = str(fd, `capacity_${id}`);
    const hoursRaw = str(fd, `hours_${id}`);
    await updateLineCapacity(
      id,
      capacityRaw === "" ? 0 : Math.max(0, dec(fd, `capacity_${id}`)),
      hoursRaw === "" ? 0 : Math.max(0, dec(fd, `hours_${id}`)),
      optStr(fd, `note_${id}`)
    );
  }
  revalidatePath("/masters");
  revalidatePath("/report");
}

export async function deleteLineAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  await requireMasterUnlocked();
  const id = str(fd, "id");
  if (!id) return;
  await deleteLine(id);
  revalidatePath("/masters");
  revalidatePath("/report");
}

/* ===== マスタ：作業者 ===== */

export async function saveWorkerAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  await requireMasterUnlocked();
  const id = optStr(fd, "id");
  const factoryId = str(fd, "factoryId");
  const employeeNo = str(fd, "employeeNo");
  const name = str(fd, "name");
  if (!factoryId || !employeeNo || !name) {
    throw new Error("工場・社員番号・氏名を入力してください");
  }
  const input = {
    factoryId,
    lineId: optStr(fd, "lineId"),
    employeeNo,
    name,
    active: bool(fd, "active"),
  };
  if (id) await updateWorker(id, input);
  else await createWorker(input);
  revalidatePath("/masters");
  revalidatePath("/report");
}

export async function deleteWorkerAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  await requireMasterUnlocked();
  const id = str(fd, "id");
  if (!id) return;
  await deleteWorker(id);
  revalidatePath("/masters");
}
