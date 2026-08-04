"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import {
  formatBreaks,
  hourlyRate,
  suggestOvertimeMinutes,
  theoreticalAt,
} from "@/lib/capacity";
import { formatHours } from "@/lib/format";
import {
  OVERTIME_DECISIONS,
  OVERTIME_DECISION_LABEL,
  PROGRESS_STATUS_LABEL,
  QTY_LABEL,
  REASONS,
  REPORT_KIND_LABEL,
  type Factory,
  type Line,
  type OvertimeDecision,
  type ProgressStatus,
  type ReportKind,
  type Worker,
} from "@/lib/types";
import SubmitButton from "./SubmitButton";

export interface ReportDefaults {
  date: string;
  factoryId: string;
  lineId: string;
  /** 現在時刻（JST）。チェック時刻の初期値 */
  now: string;
  /** その日の計画数（未登録なら null → ライン実力を初期値にする） */
  plannedQty: number | null;
  /** その日の始業（未登録ならラインの既定） */
  startTime: string | null;
  headcount: number | null;
}

const pill = (on: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm font-medium transition ${
    on
      ? "border-teal-700 bg-teal-700 text-white"
      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
  }`;

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

/**
 * 進捗チェック／終業後の入力フォーム。
 *
 * ライン実力（台/日）と稼働時間（H）から時間当たりの出来高を出し、
 * 始業からチェック時刻までの経過時間から休憩を差し引いて「その時点の理論値」を自動計算する。
 * 実績はその理論値を初期値として入れ、実態と違えば上書きしてもらう。
 */
export default function ReportForm({
  factories,
  lines,
  workers,
  defaults,
  action,
}: {
  factories: Factory[];
  lines: Line[];
  workers: Worker[];
  defaults: ReportDefaults;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const router = useRouter();

  const [date, setDate] = useState(defaults.date);
  const [factoryId, setFactoryId] = useState(defaults.factoryId);
  const [lineId, setLineId] = useState(defaults.lineId);

  const factoryLines = useMemo(
    () => lines.filter((l) => l.factoryId === factoryId),
    [lines, factoryId]
  );
  const line = lines.find((l) => l.id === lineId) ?? null;

  const [startTime, setStartTime] = useState(defaults.startTime ?? line?.startTime ?? "08:00");
  const [kind, setKind] = useState<ReportKind>("checkpoint");
  const [reportTime, setReportTime] = useState(defaults.now);
  const [plannedQty, setPlannedQty] = useState(
    String(defaults.plannedQty ?? Math.round(line?.capacityPerDay ?? 0))
  );
  const [actualQty, setActualQty] = useState("");
  const [actualTouched, setActualTouched] = useState(false);
  const [progressStatus, setProgressStatus] = useState<ProgressStatus | null>(null);
  const [decision, setDecision] = useState<OvertimeDecision | null>(null);
  const [bulkMinutes, setBulkMinutes] = useState("60");
  const [selected, setSelected] = useState<Record<string, number>>({});

  const planned = Number(plannedQty);
  const theoretical = useMemo(() => {
    if (!line) return 0;
    return theoreticalAt(
      { ...line, startTime },
      reportTime,
      Number.isFinite(planned) && planned > 0 ? planned : undefined
    );
  }, [line, startTime, reportTime, planned]);

  // 実績は理論値を初期値にする。ユーザーが触ったあとは、その入力値をそのまま使う
  const actualValue = actualTouched ? actualQty : String(theoretical);
  const actual = Number(actualValue);
  const gap = Number.isFinite(actual) ? theoretical - actual : 0;
  const shortfallVsPlan =
    Number.isFinite(actual) && Number.isFinite(planned) ? planned - actual : 0;
  const effectiveStatus: ProgressStatus = progressStatus ?? (gap > 0 ? "delayed" : "ontrack");
  const effectiveDecision: OvertimeDecision =
    decision ?? (shortfallVsPlan > 0 && kind === "closing" ? "do" : gap > 0 ? "do" : "none");

  const qty = QTY_LABEL[line?.lineType ?? "assembly"];
  const isProcess = line?.lineType === "process";

  const suggested = line ? suggestOvertimeMinutes(line, Math.max(gap, shortfallVsPlan)) : null;

  // 選んだラインの工場の作業者だけを対象にする（同じライン所属を上に並べる）
  const candidates = useMemo(() => {
    if (!line) return [];
    return workers
      .filter((w) => w.factoryId === line.factoryId)
      .sort((a, b) => {
        const am = a.lineId === line.id ? 0 : 1;
        const bm = b.lineId === line.id ? 0 : 1;
        return am - bm || a.employeeNo.localeCompare(b.employeeNo);
      });
  }, [workers, line]);

  const totalMinutes = candidates.reduce((s, w) => s + (selected[w.id] ?? 0), 0);
  const selectedCount = candidates.filter((w) => (selected[w.id] ?? 0) > 0).length;

  /** 日付・工場・ラインを変えたら、その組み合わせのデータを読み直す。 */
  const navigate = (next: { date?: string; factoryId?: string; lineId?: string }) => {
    const d = next.date ?? date;
    const f = next.factoryId ?? factoryId;
    const l = next.lineId ?? lineId;
    router.push(`/report?date=${encodeURIComponent(d)}&factory=${encodeURIComponent(f)}&line=${encodeURIComponent(l)}`);
  };

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="lineId" value={lineId} />
      <input type="hidden" name="reportDate" value={date} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="progressStatus" value={effectiveStatus} />
      <input type="hidden" name="overtimeDecision" value={effectiveDecision} />
      <input type="hidden" name="headcount" value={String(defaults.headcount ?? line?.headcount ?? 0)} />

      {/* ===== 日付・工場・ライン ===== */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Label text="日付" required>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              navigate({ date: e.target.value });
            }}
            className={`${inputCls} w-full`}
            required
          />
        </Label>
        <Label text="工場" required>
          <select
            value={factoryId}
            onChange={(e) => {
              const nextFactory = e.target.value;
              const nextLine = lines.find((l) => l.factoryId === nextFactory)?.id ?? "";
              setFactoryId(nextFactory);
              setLineId(nextLine);
              navigate({ factoryId: nextFactory, lineId: nextLine });
            }}
            className={`${inputCls} w-full`}
            required
          >
            {factories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Label>
      </div>

      <Label text="ライン" required>
        <select
          value={lineId}
          onChange={(e) => {
            setLineId(e.target.value);
            navigate({ lineId: e.target.value });
          }}
          className={`${inputCls} w-full`}
          required
        >
          <option value="">選択してください</option>
          {factoryLines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Label>

      {/* ===== 前提（ライン実力・始業・休憩） ===== */}
      {line ? (
        <div className="rounded-xl bg-slate-100 p-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
            <span className="text-slate-700">
              {qty.capacity}：
              <strong className="text-base text-slate-900">
                {line.capacityPerDay}
                {qty.unit}/日
              </strong>
              <span className="ml-1 text-slate-500">（{line.workHours}H稼働）</span>
            </span>
            <span className="font-medium text-amber-700">
              {reportTime}時点の目安：約{theoretical}
              {qty.unit}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            始業
            <input
              type="time"
              name="startTime"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
            />
            <span className="text-slate-500">
              （時間当たり {hourlyRate({ ...line, startTime }).toFixed(1)}
              {qty.unit}/h）
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {line.breaks.length > 0
              ? `前提：休憩 ${formatBreaks(line.breaks)} を差し引いて理論値を計算`
              : "前提：休憩の登録がありません（マスタ設定で登録すると理論値の精度が上がります）"}
          </p>
        </div>
      ) : (
        <p className="rounded-xl bg-slate-100 p-4 text-sm text-slate-500">
          ラインを選ぶと、ライン実力から理論値を計算します。
        </p>
      )}

      {/* ===== 入力タイミング ===== */}
      <div>
        <Legend text="入力タイミング" required />
        <div className="flex flex-wrap gap-2">
          {(["checkpoint", "closing"] as ReportKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={pill(kind === k)}>
              {REPORT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {/* ===== 入力本体 ===== */}
      <div className="space-y-4 rounded-xl bg-slate-50 p-4">
        <Label
          text={kind === "closing" ? "終業時刻" : "チェック時刻"}
          hint="自動で現在時刻が入ります。実態と違う場合は直してください"
        >
          <input
            type="time"
            name="reportTime"
            value={reportTime}
            onChange={(e) => setReportTime(e.target.value)}
            className={`${inputCls} w-40`}
            required
          />
        </Label>

        <div className="grid gap-4 sm:grid-cols-2">
          <Label text={`計画数（本日分）`} required>
            <input
              type="number"
              name="plannedQty"
              min={0}
              step={1}
              inputMode="numeric"
              value={plannedQty}
              onChange={(e) => setPlannedQty(e.target.value)}
              className={`${inputCls} w-full`}
              required
            />
          </Label>
          <Label
            text={kind === "closing" ? "終業時点の実績" : "チェック時点の実績"}
            required
            hint="自動で理論値が入ります。実態と違う場合は上書きしてください"
          >
            <input
              type="number"
              name="actualQty"
              min={0}
              step={1}
              inputMode="numeric"
              value={actualValue}
              onChange={(e) => {
                setActualTouched(true);
                setActualQty(e.target.value);
              }}
              className={`${inputCls} w-full`}
              required
            />
          </Label>
        </div>

        <p className="text-xs text-slate-600">
          理論値 {theoretical}
          {qty.unit} に対して{" "}
          {gap > 0 ? (
            <strong className="text-rose-600">
              {gap}
              {qty.unit} 不足
            </strong>
          ) : (
            <strong className="text-emerald-600">
              {-gap}
              {qty.unit} 前倒し
            </strong>
          )}
          {planned > 0 ? (
            <>
              　／ 本日計画 {planned}
              {qty.unit} に対して残り{" "}
              <strong className={shortfallVsPlan > 0 ? "text-rose-600" : "text-emerald-600"}>
                {Math.max(0, shortfallVsPlan)}
                {qty.unit}
              </strong>
            </>
          ) : null}
        </p>

        <div>
          <Legend text="生産進捗" required />
          <div className="flex flex-wrap gap-2">
            {(["ontrack", "delayed"] as ProgressStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setProgressStatus(s)}
                className={pill(effectiveStatus === s)}
              >
                {PROGRESS_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Legend text="残業の要否" />
          <div className="flex flex-wrap gap-2">
            {OVERTIME_DECISIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDecision(d)}
                className={pill(effectiveDecision === d)}
              >
                {OVERTIME_DECISION_LABEL[d]}
              </button>
            ))}
          </div>
        </div>

        {/* 理由（遅延・残業のとき） */}
        {effectiveStatus === "delayed" || effectiveDecision !== "none" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="理由区分">
              <select name="reasonCode" defaultValue="shortfall" className={`${inputCls} w-full`}>
                {REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Label>
            <Label
              text={`理由・状況${isProcess && effectiveDecision === "do" ? "（前工程は必須）" : ""}`}
              required={isProcess && effectiveDecision === "do"}
            >
              <textarea
                name="reason"
                rows={2}
                maxLength={500}
                required={isProcess && effectiveDecision === "do"}
                placeholder={
                  isProcess
                    ? "例）品番Aの指図が設備トラブルで2件遅延。後工程に間に合わせるため。"
                    : "例）部材待ちで30分停止。"
                }
                className={`${inputCls} w-full`}
              />
            </Label>
          </div>
        ) : null}

        {/* 残業の対象者 */}
        {effectiveDecision === "do" ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                残業する対象者
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {selectedCount}名 / 合計 {formatHours(totalMinutes)}
                  {suggested !== null && suggested > 0 ? `（目安 ${suggested}分／人）` : ""}
                </span>
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-slate-600">
                  一括
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={bulkMinutes}
                    onChange={(e) => setBulkMinutes(e.target.value)}
                    className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm tabular-nums"
                  />
                  分
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      Object.fromEntries(
                        candidates.map((w) => [w.id, Number(bulkMinutes) || 60])
                      )
                    )
                  }
                  className="rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
                >
                  全員に設定
                </button>
                <button
                  type="button"
                  onClick={() => setSelected({})}
                  className="rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
                >
                  クリア
                </button>
              </div>
            </div>

            {candidates.length === 0 ? (
              <p className="text-sm text-slate-500">
                この工場に作業者が登録されていません。マスタ設定から登録してください。
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {candidates.map((w) => {
                  const on = (selected[w.id] ?? 0) > 0;
                  return (
                    <li key={w.id} className="flex flex-wrap items-center gap-3 py-2">
                      <label className="flex min-w-[14rem] flex-1 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name={`worker_${w.id}`}
                          checked={on}
                          onChange={(e) =>
                            setSelected((prev) => {
                              const next = { ...prev };
                              if (e.target.checked)
                                next[w.id] = prev[w.id] || Number(bulkMinutes) || 60;
                              else delete next[w.id];
                              return next;
                            })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                        />
                        <span className="tabular-nums text-slate-500">{w.employeeNo}</span>
                        <span className="font-medium text-slate-900">{w.name}</span>
                        {w.lineName ? (
                          <span className="text-xs text-slate-400">{w.lineName}</span>
                        ) : null}
                      </label>
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="number"
                          min={0}
                          step={5}
                          name={`minutes_${w.id}`}
                          value={selected[w.id] ?? ""}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [w.id]: Number(e.target.value) }))
                          }
                          disabled={!on}
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums disabled:bg-slate-50"
                        />
                        分
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <Label text="備考（任意）">
          <input type="text" name="note" maxLength={200} className={`${inputCls} w-full`} />
        </Label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="送信中…">
          {kind === "closing" ? "終業報告を登録" : "進捗を登録"}
        </SubmitButton>
        {!line ? (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Lock className="h-3.5 w-3.5" />
            ラインを選んでください
          </span>
        ) : (
          <span className="text-xs text-slate-500">
            同じ時刻でもう一度登録すると、その報告を上書きします。
          </span>
        )}
      </div>
    </form>
  );
}

function Label({
  text,
  required,
  hint,
  children,
}: {
  text: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {text}
        {required ? <span className="ml-1 text-amber-600">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function Legend({ text, required }: { text: string; required?: boolean }) {
  return (
    <div className="mb-2 text-sm font-medium text-slate-700">
      {text}
      {required ? <span className="ml-1 text-amber-600">*</span> : null}
    </div>
  );
}
