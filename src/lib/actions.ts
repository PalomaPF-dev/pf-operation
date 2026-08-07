"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession, requireMasterEditor, masterEditDepartments } from "./session";
import {
  findLoginIdById,
  listFactoryMemberLoginIds,
  listMasterEditorLoginIds,
} from "./authDb";
import {
  createFactory,
  createLine,
  deleteFactory,
  deleteLine,
  deleteReport,
  applyApproval,
  getLine,
  getReport,
  getUserScope,
  importFactoryLines,
  isLineInScope,
  saveReport,
  updateFactory,
  updateLine,
  updateLineRow,
  upsertPlan,
} from "./db";
import { parseBreaks, theoreticalAt } from "./capacity";
import { notifyApprovalDecided, notifyApprovalRequested } from "./approvalNotify";
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

  // 工場の管理者は自工場以外に入力できない
  // （ポータルの所属で絞る。画面だけでなくサーバー側でも必ず確認する）
  const scope = await getUserScope(session);
  if (!isLineInScope(scope, line)) {
    throw new Error("所属工場以外のラインには入力できません");
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
    session.userId
  );

  // 許可待ちになるのは翌日回しだけ（saveReport で approval_status を付ける条件と同じ）。
  // 残業の実施は承認不要なので通知しない。判断するのは上長ではなく生産管理部のため、
  // 宛先もここで決めてポータルへ渡す。
  if (overtimeDecision === "defer") {
    try {
      // 許可を出す生産管理部に加えて、対象工場のメンバーにも申請を共有する
      const [approvers, factoryMembers] = await Promise.all([
        listMasterEditorLoginIds(masterEditDepartments()),
        listFactoryMemberLoginIds(line.factoryName),
      ]);
      notifyApprovalRequested(
        [...approvers, ...factoryMembers].filter((id) => id !== session.loginId),
        `${session.userName} さんから翌日回しの許可申請が届いています。\n` +
          `${reportDate}　${line.factoryName} / ${line.name}` +
          (reason ? `\n理由：${reason}` : "")
      );
    } catch (e) {
      // 通知先を引けなくても報告は成立させる
      console.error("[saveReport] 許可依頼の通知先取得に失敗:", e);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/reports");
  revalidatePath("/summary");
  redirect(`/report?line=${encodeURIComponent(lineId)}&date=${encodeURIComponent(reportDate)}&saved=1`);
}

/* ===== 承認ワークフロー =====
   実施(do)      … 承認は不要。生産管理部へ報告として届く（理由の把握が目的）。
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

  // 許可が要るのは翌日回しだけ。判定できるのは生産管理部（マスタ編集権限者）のみ
  if (report.overtimeDecision !== "defer") {
    throw new Error("この報告に承認は不要です");
  }
  if (!session.canEditMaster) {
    throw new Error("翌日回しの許可は生産管理部の管理者のみ行えます");
  }
  if (verdict === "reject" && !comment) {
    throw new Error("差し戻しの理由を記載してください");
  }

  const approved = verdict === "approve";
  await applyApproval(id, approved ? "approved" : "rejected", session.userId, comment);

  // 結果は申請者だけでなく、対象工場のメンバーにも届ける
  // （翌日回しの可否でその工場の翌日の段取りが変わるため）
  try {
    const [reporterLoginId, factoryMembers] = await Promise.all([
      report.reportedById ? findLoginIdById(report.reportedById) : Promise.resolve(null),
      listFactoryMemberLoginIds(report.factoryName),
    ]);
    const to = [reporterLoginId, ...factoryMembers].filter(
      (v): v is string => !!v && v !== session.loginId
    );
    notifyApprovalDecided(
      to,
      approved,
      `${report.reportDate}　${report.factoryName} / ${report.lineName}\n` +
        `${session.userName} さんが${approved ? "許可しました" : "差し戻しました"}。` +
        (comment ? `\nコメント：${comment}` : "")
    );
  } catch (e) {
    // 通知に失敗しても許可・差し戻しは成立させる
    console.error("[approveReport] 結果の通知に失敗:", e);
  }

  revalidatePath("/approvals");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
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
