"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession, requireMasterEditor } from "./session";
import {
  createFactory,
  createLine,
  createWorker,
  deleteFactory,
  deleteLine,
  deleteReport,
  deleteWorker,
  applyApproval,
  getLine,
  getReport,
  getUserScope,
  importFactoryLines,
  isLineInScope,
  saveReport,
  setUserApprover,
  updateFactory,
  updateLine,
  updateLineRow,
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

  // 作業者マスタで担当が決まっている人は、担当ライン以外に入力できない
  // （画面の絞り込みだけでなくサーバー側でも必ず確認する）
  const scope = await getUserScope(session.loginId);
  if (!isLineInScope(scope, line)) {
    throw new Error("担当外のラインには入力できません（担当はグループ長マスタの登録で決まります）");
  }

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
  // 残業の申請内容は「人数 × 一人当たりの時間（分）」で受ける
  const overtimeHeadcount = Math.max(0, int(fd, "overtimeHeadcount"));
  const overtimeMinutesPerPerson = Math.max(0, int(fd, "overtimeMinutes"));
  if (overtimeDecision === "do" && (overtimeHeadcount <= 0 || overtimeMinutesPerPerson <= 0)) {
    throw new Error("残業を実施する場合は、人数と一人当たりの時間を入力してください");
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
      overtimeHeadcount,
      overtimeMinutesPerPerson,
    },
    session.userId,
    // 実施の承認先は本人の上長（利用者マスタで設定。未設定なら生産管理部宛て）
    session.approverId
  );

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/summary");
  redirect(`/report?line=${encodeURIComponent(lineId)}&date=${encodeURIComponent(reportDate)}&saved=1`);
}

/* ===== 承認ワークフロー =====
   実施(do)      … 承認者＝報告者の上長（未設定なら生産管理部）。承認済みが生産管理部へ届く。
   翌日回し(defer)… 生産管理部（マスタ編集権限者）が許可する。 */

export async function approveReportAction(fd: FormData): Promise<void> {
  const session = await requireAdminSession();
  const id = str(fd, "id");
  const verdict = str(fd, "verdict"); // 'approve' | 'reject'
  if (!id || (verdict !== "approve" && verdict !== "reject")) return;
  const comment = optStr(fd, "comment");

  const report = await getReport(id);
  if (!report) throw new Error("申請が見つかりません");
  if (report.approvalStatus !== "pending") throw new Error("この申請は処理済みです");

  // 権限：実施は指名された上長（生産管理部は不在時の受け皿として常に可）。
  //       翌日回しは生産管理部のみ。
  const allowed =
    report.overtimeDecision === "do"
      ? report.approverId === session.userId || session.canEditMaster
      : report.overtimeDecision === "defer"
        ? session.canEditMaster
        : false;
  if (!allowed) {
    throw new Error(
      report.overtimeDecision === "defer"
        ? "翌日回しの許可は生産管理部の管理者のみ行えます"
        : "この申請の承認者ではありません"
    );
  }
  if (verdict === "reject" && !comment) {
    throw new Error("差し戻しの理由を記載してください");
  }

  await applyApproval(id, verdict === "approve" ? "approved" : "rejected", session.userId, comment);
  revalidatePath("/approvals");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
}

/** 上長（残業申請の承認者）の設定。マスタ編集権限者のみ。 */
export async function saveUserApproverAction(fd: FormData): Promise<void> {
  await requireMasterEditor();
  const id = str(fd, "id");
  if (!id) return;
  const approverId = optStr(fd, "approverId");
  if (approverId === id) throw new Error("自分自身を上長には設定できません");
  await setUserApprover(id, approverId);
  revalidatePath("/masters");
  revalidatePath("/approvals");
}

export async function deleteReportAction(fd: FormData): Promise<void> {
  await requireAdminSession();
  const id = str(fd, "id");
  if (!id) return;
  await deleteReport(id);
  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/summary");
}

/* ===== マスタ：工場 =====
   マスタの編集系はすべて requireMasterEditor（管理者かつ生産管理部）を通す。 */

export async function saveFactoryAction(fd: FormData): Promise<void> {
  await requireMasterEditor();
  const id = optStr(fd, "id");
  const name = str(fd, "name");
  if (!name) throw new Error("工場名を入力してください");
  const code = optStr(fd, "code");
  const sortOrder = int(fd, "sortOrder");
  if (id) await updateFactory(id, name, code, sortOrder);
  else await createFactory(name, code, sortOrder);
  revalidatePath("/masters");
}

export async function deleteFactoryAction(fd: FormData): Promise<void> {
  await requireMasterEditor();
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
    product: optStr(fd, "product"),
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
  await requireMasterEditor();
  const id = optStr(fd, "id");
  const input = readLineInput(fd);
  if (id) await updateLine(id, input);
  else await createLine(input);
  revalidatePath("/masters");
  revalidatePath("/report");
}

/**
 * 器種・現状人員・生産能力・総稼働時間・備考をまとめて直す（工場・ラインマスターの表からの更新）。
 * 1つの工場ぶんを1回の送信で保存する。
 */
export async function saveCapacitiesAction(fd: FormData): Promise<void> {
  await requireMasterEditor();
  const ids = fd.getAll("lineId").filter((v): v is string => typeof v === "string");
  for (const id of ids) {
    await updateLineRow(id, {
      product: optStr(fd, `product_${id}`),
      headcount: Math.max(0, dec(fd, `headcount_${id}`)),
      capacityPerDay: Math.max(0, dec(fd, `capacity_${id}`)),
      workHours: Math.max(0, dec(fd, `hours_${id}`)),
      note: optStr(fd, `note_${id}`),
    });
  }
  revalidatePath("/masters");
  revalidatePath("/report");
}

/**
 * 受領した「工場・ラインマスター」（4工場33ライン）を取り込む（冪等）。
 * 手で直した器種・人員も受領値に戻るため、画面側で確認を挟んでいる。
 */
export async function importMasterAction(): Promise<void> {
  await requireMasterEditor();
  await importFactoryLines();
  revalidatePath("/masters");
  revalidatePath("/report");
  revalidatePath("/dashboard");
}

export async function deleteLineAction(fd: FormData): Promise<void> {
  await requireMasterEditor();
  const id = str(fd, "id");
  if (!id) return;
  await deleteLine(id);
  revalidatePath("/masters");
  revalidatePath("/report");
}

/* ===== マスタ：グループ長（ラインの残業有無の申請者） ===== */

export async function saveWorkerAction(fd: FormData): Promise<void> {
  await requireMasterEditor();
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
  };
  if (id) await updateWorker(id, input);
  else await createWorker(input);
  revalidatePath("/masters");
  revalidatePath("/report");
}

export async function deleteWorkerAction(fd: FormData): Promise<void> {
  await requireMasterEditor();
  const id = str(fd, "id");
  if (!id) return;
  await deleteWorker(id);
  revalidatePath("/masters");
}
