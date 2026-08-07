import Link from "next/link";
import {
  Bell,
  Building2,
  CalendarDays,
  Factory as FactoryIcon,
  Info,
  SlidersHorizontal,
} from "lucide-react";
import { masterEditDepartments, requireAdminSession } from "@/lib/session";
import { listCalendarDays, listFactories, listLines, listReminders } from "@/lib/db";
import {
  deleteCalendarDayAction,
  deleteFactoryAction,
  deleteLineAction,
  importMasterAction,
  saveCalendarDayAction,
  saveCapacitiesAction,
  saveFactoryAction,
  saveLineAction,
  saveRemindersAction,
  toggleCalendarDayAction,
} from "@/lib/actions";
import { formatBreaks } from "@/lib/capacity";
import {
  addMonths,
  currentMonth,
  formatDate,
  formatMonth,
  monthWeeks,
  todayString,
} from "@/lib/format";
import {
  LINE_TYPE_LABEL,
  QTY_LABEL,
  WEEKDAY_LABEL,
  capacityPerManHour,
  formatWeekdays,
  type CalendarDay,
  type Factory,
  type Line,
  type Reminder,
} from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SubmitButton from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "capacity", label: "工場・ラインマスター", icon: FactoryIcon },
  { key: "lines", label: "ライン設定", icon: SlidersHorizontal },
  { key: "factories", label: "工場", icon: Building2 },
  { key: "reminders", label: "定期通知", icon: Bell },
  { key: "calendar", label: "稼働日", icon: CalendarDays },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500";
const deleteCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60";

/** 小数は必要な桁だけ見せる（14 / 8.5 / 0.5 のように）。 */
function num(v: number, digits = 1): string {
  return Number(v.toFixed(digits)).toLocaleString("ja-JP");
}

/**
 * マスタ設定。
 * 工場・ラインマスターは全管理者が表で確認でき、編集できるのは生産管理部の管理者のみ。
 */
export default async function MastersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; month?: string; factory?: string }>;
}) {
  const session = await requireAdminSession();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "capacity";
  // 編集可否はページでもサーバーアクションでも判定する（画面はボタンを出さないだけ）
  const canEdit = session.canEditMaster;

  // 稼働日は月のカレンダーで見せる（既定は今月）
  const today = todayString();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? (sp.month as string) : currentMonth();
  // カレンダーは前後の月にはみ出す枠も描くので、その分も引いておく
  const monthFrom = `${addMonths(month, -1)}-01`;
  const monthTo = `${addMonths(month, 1)}-28`;

  let factories, lines, reminders, calendarDays;
  try {
    [factories, lines, reminders, calendarDays] = await Promise.all([
      listFactories(),
      listLines(),
      listReminders(),
      listCalendarDays(monthFrom, monthTo),
    ]);
  } catch (e) {
    console.error("[masters]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="マスタ設定" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="マスタ設定" />
      <p className="mb-3 text-sm text-slate-600">
        工場ごとのラインと、生産能力（台/日）・総稼働時間（H）を確認できます。
      </p>

      {!canEdit ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Info className="mt-px h-4 w-4 shrink-0" />
          <span>
            閲覧のみです。マスタを編集できるのは{masterEditDepartments().join("・")}
            の管理者、またはポータル管理権限を持つ管理者のみです。
          </span>
        </div>
      ) : null}

      {/* 他の PF アプリ（マスタ設定）と同じ、アイコン付きの下線タブ。モバイルは折り返す */}
      <nav className="mb-5 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/masters?tab=${t.key}`}
            className={`-mb-px inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-t-lg border-b-2 px-2.5 py-2.5 text-[13px] font-semibold transition-colors sm:gap-1.5 sm:px-4 sm:text-sm ${
              t.key === tab
                ? "border-brand-700 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "capacity" ? (
        <MasterTable factories={factories} lines={lines} canEdit={canEdit} />
      ) : null}
      {tab === "lines" ? <LinesTab factories={factories} lines={lines} canEdit={canEdit} /> : null}
      {tab === "factories" ? <FactoriesTab factories={factories} canEdit={canEdit} /> : null}
      {tab === "reminders" ? (
        <RemindersTab
          factories={factories}
          lines={lines}
          reminders={reminders}
          canEdit={canEdit}
        />
      ) : null}
      {tab === "calendar" ? (
        <CalendarTab
          factories={factories}
          days={calendarDays}
          canEdit={canEdit}
          today={today}
          month={month}
          scopeId={factories.some((f) => f.id === sp.factory) ? (sp.factory as string) : null}
        />
      ) : null}
    </div>
  );
}

/* ===== 工場・ラインマスター（工場ごとの表） ===== */

/** 受領した「工場・ラインマスター」（4工場33ライン）の一括取り込み。編集できる人にだけ出す。 */
function ImportBar() {
  return (
    <form
      action={importMasterAction}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
    >
      <p className="text-xs text-slate-600">
        生産管理部から受領した工場・ラインマスター（大口・清洲・直方・恵那の33ライン）を
        一括で取り込めます。何度実行しても同じ状態になります。
      </p>
      <SubmitButton
        pendingLabel="取り込み中…"
        confirm="受領マスタ（4工場33ライン）を取り込みます。同じ工場・ライン名の行は受領値で上書きされます（画面で直した器種・人員・実力も戻ります）。よろしいですか？"
        className="rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-60"
      >
        受領マスタを取り込む
      </SubmitButton>
    </form>
  );
}

const TH = "px-3 py-2 text-left text-xs font-semibold text-slate-600 whitespace-nowrap";
const TD = "px-3 py-2 text-sm text-slate-800 align-middle";

function MasterTable({
  factories,
  lines,
  canEdit,
}: {
  factories: Factory[];
  lines: Line[];
  canEdit: boolean;
}) {
  if (factories.length === 0) {
    return (
      <div className="space-y-4">
        {canEdit ? <ImportBar /> : null}
        <p className="text-sm text-slate-500">
          工場・ラインがまだ登録されていません。
          {canEdit ? "上の「受領マスタを取り込む」で4工場33ラインを一括登録できます。" : null}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {canEdit ? <ImportBar /> : null}
      {factories.map((f) => (
        <FactoryTable
          key={f.id}
          factory={f}
          lines={lines.filter((l) => l.factoryId === f.id)}
          canEdit={canEdit}
        />
      ))}
      <p className="text-xs text-slate-500">
        一人当たり時間出来高＝生産能力 ÷（現状人員 × 総稼働時間）。マスタ上の目安で、実績値は
        <Link href="/summary" className="mx-1 text-brand-700 underline">
          集計
        </Link>
        で確認できます。
      </p>
    </div>
  );
}

function FactoryTable({
  factory,
  lines,
  canEdit,
}: {
  factory: Factory;
  lines: Line[];
  canEdit: boolean;
}) {
  const body = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse">
        <thead className="bg-slate-50">
          <tr className="border-b border-slate-200">
            <th className={`${TH} w-20`}>ライン</th>
            <th className={`${TH} w-52`}>器種</th>
            <th className={`${TH} w-24`}>種別</th>
            <th className={`${TH} w-24 text-right`}>現状人員</th>
            <th className={`${TH} w-32 text-right`}>生産能力</th>
            <th className={`${TH} w-28 text-right`}>総稼働時間</th>
            <th className={`${TH} w-32 text-right`}>一人当たり</th>
            <th className={TH}>備考</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => {
            const unit = QTY_LABEL[l.lineType].unit;
            const perManHour = capacityPerManHour(l);
            return (
              <tr key={l.id} className={l.active ? "" : "bg-slate-50/60 text-slate-400"}>
                <td className={`${TD} font-bold text-slate-900`}>
                  {l.name}
                  {!l.active ? (
                    <span className="ml-1 text-[10px] font-normal text-slate-400">停止中</span>
                  ) : null}
                </td>
                <td className={TD}>
                  {canEdit ? (
                    <>
                      <input type="hidden" name="lineId" value={l.id} />
                      <input
                        type="text"
                        name={`product_${l.id}`}
                        defaultValue={l.product ?? ""}
                        maxLength={60}
                        placeholder="器種"
                        className={`${inputCls} w-full min-w-[11rem]`}
                      />
                    </>
                  ) : (
                    (l.product ?? "—")
                  )}
                </td>
                <td className={`${TD} text-xs text-slate-500`}>{LINE_TYPE_LABEL[l.lineType]}</td>
                <td className={`${TD} text-right tabular-nums`}>
                  {canEdit ? (
                    <input
                      type="number"
                      name={`headcount_${l.id}`}
                      defaultValue={l.headcount || ""}
                      min={0}
                      step={0.5}
                      className={`${inputCls} w-20 text-right tabular-nums`}
                    />
                  ) : (
                    <>{l.headcount ? `${num(l.headcount)}人` : "—"}</>
                  )}
                </td>
                <td className={`${TD} text-right tabular-nums`}>
                  {canEdit ? (
                    <span className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        name={`capacity_${l.id}`}
                        defaultValue={l.capacityPerDay || ""}
                        min={0}
                        step={1}
                        className={`${inputCls} w-24 text-right tabular-nums`}
                      />
                      <span className="text-xs text-slate-500">{unit}/日</span>
                    </span>
                  ) : (
                    <>{l.capacityPerDay ? `${num(l.capacityPerDay, 0)}${unit}/日` : "—"}</>
                  )}
                </td>
                <td className={`${TD} text-right tabular-nums`}>
                  {canEdit ? (
                    <span className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        name={`hours_${l.id}`}
                        defaultValue={l.workHours || ""}
                        min={0}
                        step={0.5}
                        className={`${inputCls} w-20 text-right tabular-nums`}
                      />
                      <span className="text-xs text-slate-500">H</span>
                    </span>
                  ) : (
                    <>{l.workHours ? `${num(l.workHours)}H` : "—"}</>
                  )}
                </td>
                <td className={`${TD} text-right tabular-nums text-slate-600`}>
                  {perManHour === null ? "—" : `${num(perManHour, 2)} ${unit}/人・H`}
                </td>
                <td className={TD}>
                  {canEdit ? (
                    <input
                      type="text"
                      name={`note_${l.id}`}
                      defaultValue={l.note ?? ""}
                      maxLength={200}
                      placeholder="備考（任意）"
                      className={`${inputCls} w-full min-w-[12rem]`}
                    />
                  ) : (
                    <span className="text-xs text-slate-500">{l.note ?? ""}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <h2 className="flex items-baseline gap-2 border-b border-slate-200 bg-brand-50 px-4 py-3">
        {factory.code ? (
          <span className="rounded bg-brand-200 px-1.5 py-0.5 font-mono text-xs font-bold text-brand-900">
            {factory.code}
          </span>
        ) : null}
        <span className="text-sm font-bold text-slate-900">{factory.name}</span>
        <span className="text-xs text-slate-500">{lines.length}ライン</span>
      </h2>
      {lines.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          この工場のラインが登録されていません。
        </p>
      ) : canEdit ? (
        <form action={saveCapacitiesAction}>
          {body}
          <div className="border-t border-slate-100 px-4 py-3">
            <SubmitButton>{factory.name}を保存</SubmitButton>
          </div>
        </form>
      ) : (
        body
      )}
    </section>
  );
}

/* ===== ライン設定（種別・始業・休憩など） ===== */

function LineFields({
  factories,
  line,
  canEdit,
}: {
  factories: Factory[];
  line?: Line;
  canEdit: boolean;
}) {
  const disabled = !canEdit;
  return (
    <>
      <Field label="工場">
        <select
          name="factoryId"
          defaultValue={line?.factoryId ?? factories[0]?.id ?? ""}
          required
          disabled={disabled}
          className={`${inputCls} w-36`}
        >
          {factories.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="ライン名">
        <input
          type="text"
          name="name"
          defaultValue={line?.name ?? ""}
          required
          maxLength={60}
          placeholder="#1"
          disabled={disabled}
          className={`${inputCls} w-28`}
        />
      </Field>
      <Field label="器種">
        <input
          type="text"
          name="product"
          defaultValue={line?.product ?? ""}
          maxLength={60}
          placeholder="片面ホーロー"
          disabled={disabled}
          className={`${inputCls} w-44`}
        />
      </Field>
      <Field label="種別">
        <select
          name="lineType"
          defaultValue={line?.lineType ?? "assembly"}
          disabled={disabled}
          className={`${inputCls} w-32`}
        >
          <option value="assembly">{LINE_TYPE_LABEL.assembly}</option>
          <option value="process">{LINE_TYPE_LABEL.process}</option>
        </select>
      </Field>
      <Field label="生産能力/日">
        <input
          type="number"
          name="capacityPerDay"
          min={0}
          step={1}
          defaultValue={line?.capacityPerDay ?? 0}
          disabled={disabled}
          className={`${inputCls} w-24 text-right tabular-nums`}
        />
      </Field>
      <Field label="総稼働時間(H)">
        <input
          type="number"
          name="workHours"
          min={0}
          step={0.5}
          defaultValue={line?.workHours ?? 8}
          disabled={disabled}
          className={`${inputCls} w-24 text-right tabular-nums`}
        />
      </Field>
      <Field label="始業">
        <input
          type="time"
          name="startTime"
          defaultValue={line?.startTime ?? "08:00"}
          disabled={disabled}
          className={`${inputCls} w-28`}
        />
      </Field>
      <Field label="休憩（開始-終了）">
        <input
          type="text"
          name="breaks"
          defaultValue={line ? formatBreaks(line.breaks) : "10:00-10:10／12:10-12:50／14:50-15:00"}
          placeholder="10:00-10:10／12:10-12:50"
          disabled={disabled}
          className={`${inputCls} w-64`}
        />
      </Field>
      <Field label="現状人員">
        <input
          type="number"
          name="headcount"
          min={0}
          step={0.5}
          defaultValue={line?.headcount ?? 0}
          disabled={disabled}
          className={`${inputCls} w-20 text-right tabular-nums`}
        />
      </Field>
      <Field label="表示順">
        <input
          type="number"
          name="sortOrder"
          defaultValue={line?.sortOrder ?? 0}
          disabled={disabled}
          className={`${inputCls} w-20 text-right tabular-nums`}
        />
      </Field>
      <Field label="備考">
        <input
          type="text"
          name="note"
          defaultValue={line?.note ?? ""}
          maxLength={200}
          disabled={disabled}
          className={`${inputCls} w-48`}
        />
      </Field>
      <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-600">
        <input
          type="checkbox"
          name="active"
          defaultChecked={line?.active ?? true}
          disabled={disabled}
          className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
        />
        稼働中
      </label>
    </>
  );
}

function LinesTab({
  factories,
  lines,
  canEdit,
}: {
  factories: Factory[];
  lines: Line[];
  canEdit: boolean;
}) {
  if (factories.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        先に
        <Link href="/masters?tab=factories" className="mx-1 text-brand-700 underline">
          工場
        </Link>
        を登録してください。
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {canEdit ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">ラインを追加</h2>
          <form action={saveLineAction} className="flex flex-wrap items-end gap-3">
            <LineFields factories={factories} canEdit />
            <SubmitButton>追加</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            組立ラインは「生産能力に対して時間当たりで間に合っているか」、前工程は「決められた時刻までに計画された製造指図が消化できているか」を追います。休憩は理論値の計算から差し引かれます。
          </p>
        </section>
      ) : null}

      {lines.length === 0 ? (
        <p className="text-sm text-slate-500">ラインがまだ登録されていません。</p>
      ) : (
        <ul className="space-y-2">
          {lines.map((l) => (
            <li key={l.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <form action={saveLineAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={l.id} />
                <LineFields factories={factories} line={l} canEdit={canEdit} />
                {canEdit ? <SubmitButton>更新</SubmitButton> : null}
              </form>
              {canEdit ? (
                <form action={deleteLineAction} className="mt-2">
                  <input type="hidden" name="id" value={l.id} />
                  <SubmitButton
                    pendingLabel="削除中…"
                    confirm={`「${l.factoryName} / ${l.name}」を削除します。このラインの計画・報告も削除されます。よろしいですか？`}
                    className={deleteCls}
                  >
                    削除
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ===== 工場 ===== */

function FactoriesTab({ factories, canEdit }: { factories: Factory[]; canEdit: boolean }) {
  return (
    <div className="space-y-4">
      {canEdit ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">工場を追加</h2>
          <form action={saveFactoryAction} className="flex flex-wrap items-end gap-3">
            <Field label="工場コード">
              <input
                type="text"
                name="code"
                maxLength={8}
                placeholder="02"
                className={`${inputCls} w-24`}
              />
            </Field>
            <Field label="工場名">
              <input type="text" name="name" required maxLength={60} className={`${inputCls} w-56`} />
            </Field>
            <Field label="表示順">
              <input
                type="number"
                name="sortOrder"
                defaultValue={factories.length * 10}
                className={`${inputCls} w-24 text-right tabular-nums`}
              />
            </Field>
            <SubmitButton>追加</SubmitButton>
          </form>
        </section>
      ) : null}

      {factories.length === 0 ? (
        <p className="text-sm text-slate-500">工場がまだ登録されていません。</p>
      ) : (
        <ul className="space-y-2">
          {factories.map((f) => (
            <li key={f.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <form action={saveFactoryAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={f.id} />
                <Field label="工場コード">
                  <input
                    type="text"
                    name="code"
                    defaultValue={f.code ?? ""}
                    maxLength={8}
                    disabled={!canEdit}
                    className={`${inputCls} w-24`}
                  />
                </Field>
                <Field label="工場名">
                  <input
                    type="text"
                    name="name"
                    defaultValue={f.name}
                    required
                    maxLength={60}
                    disabled={!canEdit}
                    className={`${inputCls} w-56`}
                  />
                </Field>
                <Field label="表示順">
                  <input
                    type="number"
                    name="sortOrder"
                    defaultValue={f.sortOrder}
                    disabled={!canEdit}
                    className={`${inputCls} w-24 text-right tabular-nums`}
                  />
                </Field>
                {canEdit ? <SubmitButton>更新</SubmitButton> : null}
              </form>
              {canEdit ? (
                <form action={deleteFactoryAction} className="mt-2">
                  <input type="hidden" name="id" value={f.id} />
                  <SubmitButton
                    pendingLabel="削除中…"
                    confirm={`「${f.name}」を削除します。配下のライン・グループ長・報告も削除されます。よろしいですか？`}
                    className={deleteCls}
                  >
                    削除
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ===== 定期通知（入力を促す LINE WORKS 通知） =====
   工場・ラインマスターと同じ「工場ごとの表」。1行＝1つの対象（工場全体／各ライン）で、
   通知時刻は1つの欄にまとめて入力する（例：9:00, 13:00, 16:00）。 */

function WeekdayBoxes({
  name,
  weekdays,
  disabled,
}: {
  name: string;
  weekdays: number[];
  disabled: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      {WEEKDAY_LABEL.map((label, d) => (
        <label key={d} className="flex flex-col items-center text-[10px] text-slate-500">
          {label}
          <input
            type="checkbox"
            name={`${name}_${d}`}
            defaultChecked={weekdays.includes(d)}
            disabled={disabled}
            className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
          />
        </label>
      ))}
    </span>
  );
}

function ReminderRow({
  factoryId,
  lineId,
  label,
  sub,
  reminder,
  canEdit,
}: {
  factoryId: string;
  lineId: string | null;
  label: string;
  sub?: string | null;
  reminder?: Reminder;
  canEdit: boolean;
}) {
  const key = lineId ?? factoryId;
  const times = reminder?.remindTimes ?? [];
  const weekdays = reminder?.weekdays ?? [1, 2, 3, 4, 5];
  return (
    <tr className={times.length === 0 ? "text-slate-500" : ""}>
      <td className={`${TD} font-bold text-slate-900`}>
        {canEdit ? <input type="hidden" name="target" value={`${factoryId}|${lineId ?? ""}`} /> : null}
        {label}
        {sub ? <span className="ml-1 text-[11px] font-normal text-slate-400">{sub}</span> : null}
      </td>
      <td className={TD}>
        {canEdit ? (
          <input
            type="text"
            name={`times_${key}`}
            defaultValue={times.join(", ")}
            placeholder="9:00, 13:00, 16:00"
            className={`${inputCls} w-full min-w-[10rem] tabular-nums`}
          />
        ) : times.length > 0 ? (
          <span className="tabular-nums text-slate-800">{times.join("・")}</span>
        ) : (
          <span className="text-xs text-slate-400">通知しない</span>
        )}
      </td>
      <td className={TD}>
        {canEdit ? (
          <WeekdayBoxes name={`weekday_${key}`} weekdays={weekdays} disabled={false} />
        ) : (
          <span className="text-xs text-slate-600">
            {times.length > 0 ? formatWeekdays(weekdays) : "—"}
          </span>
        )}
      </td>
      <td className={TD}>
        {canEdit ? (
          <input
            type="text"
            name={`recipients_${key}`}
            defaultValue={reminder?.recipients.join(", ") ?? ""}
            placeholder="工場のメンバー全員"
            className={`${inputCls} w-full min-w-[9rem]`}
          />
        ) : (
          <span className="text-xs text-slate-600">
            {reminder && reminder.recipients.length > 0
              ? reminder.recipients.join("・")
              : times.length > 0
                ? "工場のメンバー全員"
                : "—"}
          </span>
        )}
      </td>
      <td className={TD}>
        {canEdit ? (
          <input
            type="text"
            name={`message_${key}`}
            defaultValue={reminder?.message ?? ""}
            maxLength={200}
            placeholder="ひとこと（任意）"
            className={`${inputCls} w-full min-w-[10rem]`}
          />
        ) : (
          <span className="text-xs text-slate-600">{reminder?.message ?? ""}</span>
        )}
      </td>
      <td className={`${TD} text-center`}>
        {canEdit ? (
          <input
            type="checkbox"
            name={`skipIfReported_${key}`}
            defaultChecked={reminder?.skipIfReported ?? true}
            className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
          />
        ) : (
          <span className="text-xs text-slate-600">
            {times.length === 0 ? "—" : reminder?.skipIfReported ? "する" : "しない"}
          </span>
        )}
      </td>
      <td className={`${TD} whitespace-nowrap text-[11px] text-slate-400`}>
        {reminder?.lastSentDate
          ? `${reminder.lastSentDate}${reminder.lastSentTime ? ` ${reminder.lastSentTime}` : ""}`
          : "—"}
      </td>
    </tr>
  );
}

function FactoryReminderTable({
  factory,
  lines,
  reminders,
  canEdit,
}: {
  factory: Factory;
  lines: Line[];
  reminders: Reminder[];
  canEdit: boolean;
}) {
  const wide = reminders.find((r) => r.lineId === null);
  const body = (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse">
        <thead className="bg-slate-50">
          <tr className="border-b border-slate-200">
            <th className={`${TH} w-28`}>対象</th>
            <th className={`${TH} w-56`}>通知時刻（複数可）</th>
            <th className={`${TH} w-48`}>曜日</th>
            <th className={`${TH} w-44`}>送り先の社員番号</th>
            <th className={TH}>ひとこと</th>
            <th className={`${TH} w-24 text-center`}>報告済は送らない</th>
            <th className={`${TH} w-32`}>最終送信</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <ReminderRow
            factoryId={factory.id}
            lineId={null}
            label="工場全体"
            sub="未報告のラインをまとめて促す"
            reminder={wide}
            canEdit={canEdit}
          />
          {lines.map((l) => (
            <ReminderRow
              key={l.id}
              factoryId={factory.id}
              lineId={l.id}
              label={l.name}
              sub={l.product}
              reminder={reminders.find((r) => r.lineId === l.id)}
              canEdit={canEdit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <h2 className="flex items-baseline gap-2 border-b border-slate-200 bg-brand-50 px-4 py-3">
        {factory.code ? (
          <span className="rounded bg-brand-200 px-1.5 py-0.5 font-mono text-xs font-bold text-brand-900">
            {factory.code}
          </span>
        ) : null}
        <span className="text-sm font-bold text-slate-900">{factory.name}</span>
        <span className="text-xs text-slate-500">
          通知{reminders.filter((r) => r.remindTimes.length > 0).length}件
        </span>
      </h2>
      {canEdit ? (
        <form action={saveRemindersAction}>
          {body}
          <div className="border-t border-slate-100 px-4 py-3">
            <SubmitButton>{factory.name}を保存</SubmitButton>
          </div>
        </form>
      ) : (
        body
      )}
    </section>
  );
}

function RemindersTab({
  factories,
  lines,
  reminders,
  canEdit,
}: {
  factories: Factory[];
  lines: Line[];
  reminders: Reminder[];
  canEdit: boolean;
}) {
  if (factories.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        先に
        <Link href="/masters?tab=factories" className="mx-1 text-brand-700 underline">
          工場
        </Link>
        を登録してください。
      </p>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-600">
        決めた時刻に「進捗・残業の入力をお願いします」を
        <strong className="font-medium">LINE WORKS</strong>へ送ります。
        時刻は「9:00, 13:00, 16:00」のようにまとめて入力できます（空にすればその行は送りません）。
        送り先を空にすると、その工場に所属する管理者全員に届きます。
      </p>

      {factories.map((f) => (
        <FactoryReminderTable
          key={f.id}
          factory={f}
          lines={lines.filter((l) => l.factoryId === f.id && l.active)}
          reminders={reminders.filter((r) => r.factoryId === f.id)}
          canEdit={canEdit}
        />
      ))}

      <p className="text-xs text-slate-500">
        通知は15分ごとの定期処理で送ります（設定時刻から最大15分ほど遅れることがあります）。
        <Link href="/masters?tab=calendar" className="mx-1 text-brand-700 underline">
          稼働日
        </Link>
        で休業日にした日は送りません。LINE WORKS が未設定の方には届きません。
      </p>
    </div>
  );
}

/* ===== 稼働日（休業日・臨時稼働日） =====
   月のカレンダーで、日を押すたびに 指定なし → 休業日 → 臨時稼働 → 指定なし と切り替える。 */

const CAL_CELL =
  "flex h-16 w-full flex-col items-start gap-0.5 rounded-lg border px-1.5 py-1 text-left transition-colors sm:h-20";

function CalendarTab({
  factories,
  days,
  canEdit,
  today,
  month,
  scopeId,
}: {
  factories: Factory[];
  days: CalendarDay[];
  canEdit: boolean;
  today: string;
  /** 表示中の月 "YYYY-MM" */
  month: string;
  /** 表示中の対象。null なら全工場共通 */
  scopeId: string | null;
}) {
  const scope = factories.find((f) => f.id === scopeId) ?? null;
  // 表示中の対象の指定と、参考に見せる全工場共通の指定
  const mine = new Map(days.filter((d) => d.factoryId === scopeId).map((d) => [d.date, d]));
  const common = new Map(days.filter((d) => d.factoryId === null).map((d) => [d.date, d]));
  const weeks = monthWeeks(month);
  const scopeQuery = scope ? `&factory=${scope.id}` : "";
  const monthLink = (m: string) => `/masters?tab=calendar&month=${m}${scopeQuery}`;
  const rows = [...mine.values()].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">
        曜日の設定だけでは拾えない休み（祝日・お盆・年末年始）と、休日出勤（臨時稼働）を登録します。
        休業日にした日は
        <Link href="/masters?tab=reminders" className="mx-1 text-brand-700 underline">
          定期通知
        </Link>
        を送りません。臨時稼働にした日は、曜日の設定に入っていなくても送ります。
        {canEdit ? "日付を押すたびに 休業日 → 臨時稼働 → 指定なし と変わります。" : null}
      </p>

      {/* 対象の切り替え。全工場共通（会社休日）と工場ごとの指定を分けて持つ */}
      <nav className="flex flex-wrap gap-1.5">
        {[{ id: null as string | null, name: "全工場共通" }, ...factories].map((f) => {
          const active = (f.id ?? null) === scopeId;
          return (
            <Link
              key={f.id ?? "common"}
              href={`/masters?tab=calendar&month=${month}${f.id ? `&factory=${f.id}` : ""}`}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-brand-700 text-white"
                  : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f.name}
            </Link>
          );
        })}
      </nav>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-brand-50 px-4 py-3">
          <Link
            href={monthLink(addMonths(month, -1))}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            ← 前の月
          </Link>
          <span className="text-sm font-bold text-slate-900">{formatMonth(month)}</span>
          <Link
            href={monthLink(addMonths(month, 1))}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            次の月 →
          </Link>
          {month === today.slice(0, 7) ? null : (
            <Link href={monthLink(today.slice(0, 7))} className="text-xs text-brand-700 underline">
              今月へ
            </Link>
          )}
          <span className="ml-auto text-xs text-slate-600">
            {scope ? scope.name : "全工場共通（会社休日）"}
          </span>
        </div>

        <CalendarGrid
          weeks={weeks}
          mine={mine}
          common={common}
          canEdit={canEdit}
          today={today}
          month={month}
          scopeId={scopeId}
          showCommon={scopeId !== null}
        />

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-600">
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded border border-rose-300 bg-rose-100" />休業日（通知を送らない）
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded border border-brand-400 bg-brand-100" />臨時稼働（曜日に関係なく送る）
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-3 rounded border border-slate-200 bg-white" />指定なし（曜日の設定どおり）
          </span>
          {scopeId ? <span>「共」＝全工場共通の指定（この工場の指定があればそちらが優先）</span> : null}
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          {formatMonth(month)}の{scope ? scope.name : "全工場共通"}の指定はありません（曜日の設定どおりに送ります）。
        </p>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <h3 className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900">
            {formatMonth(month)}の指定
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className={`${TH} w-28`}>日付</th>
                  <th className={`${TH} w-28`}>区分</th>
                  <th className={TH}>メモ</th>
                  {canEdit ? <th className={`${TH} w-24`} /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d) => (
                  <tr key={d.id} className={d.date < today ? "text-slate-400" : ""}>
                    <td className={`${TD} whitespace-nowrap font-bold text-slate-900`}>
                      {formatDate(d.date)}
                    </td>
                    <td className={TD}>
                      {d.working ? (
                        <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-800">
                          臨時稼働
                        </span>
                      ) : (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                          休業日
                        </span>
                      )}
                    </td>
                    <td className={TD}>
                      {canEdit ? (
                        <form action={saveCalendarDayAction} className="flex items-center gap-2">
                          <input type="hidden" name="date" value={d.date} />
                          <input type="hidden" name="factoryId" value={d.factoryId ?? ""} />
                          <input type="hidden" name="kind" value={d.working ? "working" : "holiday"} />
                          <input
                            type="text"
                            name="note"
                            defaultValue={d.note ?? ""}
                            maxLength={100}
                            placeholder="例）お盆休み"
                            className={`${inputCls} w-full min-w-[12rem]`}
                          />
                          <SubmitButton className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                            保存
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="text-xs text-slate-600">{d.note ?? ""}</span>
                      )}
                    </td>
                    {canEdit ? (
                      <td className={TD}>
                        <form action={deleteCalendarDayAction}>
                          <input type="hidden" name="id" value={d.id} />
                          <SubmitButton
                            pendingLabel="削除中…"
                            confirm={`${formatDate(d.date)}（${d.factoryName ?? "全工場共通"}）の指定を消します。よろしいですか？`}
                            className={deleteCls}
                          >
                            削除
                          </SubmitButton>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function CalendarGrid({
  weeks,
  mine,
  common,
  canEdit,
  today,
  month,
  scopeId,
  showCommon,
}: {
  weeks: { date: string; day: number; weekday: number; inMonth: boolean }[][];
  mine: Map<string, CalendarDay>;
  common: Map<string, CalendarDay>;
  canEdit: boolean;
  today: string;
  month: string;
  scopeId: string | null;
  showCommon: boolean;
}) {
  const grid = (
    <div className="p-2 sm:p-3">
      <div className="grid grid-cols-7 gap-1 pb-1">
        {WEEKDAY_LABEL.map((label, d) => (
          <div
            key={d}
            className={`text-center text-[11px] font-semibold ${
              d === 0 ? "text-rose-500" : d === 6 ? "text-sky-600" : "text-slate-500"
            }`}
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flat().map((cell) => (
          <CalendarCell
            key={cell.date}
            cell={cell}
            day={mine.get(cell.date)}
            commonDay={showCommon ? common.get(cell.date) : undefined}
            canEdit={canEdit}
            isToday={cell.date === today}
          />
        ))}
      </div>
    </div>
  );

  if (!canEdit) return grid;
  return (
    <form action={toggleCalendarDayAction}>
      <input type="hidden" name="factoryId" value={scopeId ?? ""} />
      <input type="hidden" name="month" value={month} />
      {grid}
    </form>
  );
}

function CalendarCell({
  cell,
  day,
  commonDay,
  canEdit,
  isToday,
}: {
  cell: { date: string; day: number; weekday: number; inMonth: boolean };
  day?: CalendarDay;
  commonDay?: CalendarDay;
  canEdit: boolean;
  isToday: boolean;
}) {
  const tone = !day
    ? "border-slate-200 bg-white hover:bg-slate-50"
    : day.working
      ? "border-brand-400 bg-brand-100 hover:bg-brand-200"
      : "border-rose-300 bg-rose-100 hover:bg-rose-200";
  const dim = cell.inMonth ? "" : "opacity-40";
  const ring = isToday ? "ring-2 ring-brand-600 ring-offset-1" : "";
  const dayColor = day
    ? "text-slate-900"
    : cell.weekday === 0
      ? "text-rose-500"
      : cell.weekday === 6
        ? "text-sky-600"
        : "text-slate-700";

  const inner = (
    <>
      <span className={`text-xs font-bold tabular-nums ${dayColor}`}>{cell.day}</span>
      {day ? (
        <span
          className={`rounded px-1 text-[10px] font-medium ${
            day.working ? "bg-brand-700 text-white" : "bg-rose-600 text-white"
          }`}
        >
          {day.working ? "稼働" : "休業"}
        </span>
      ) : commonDay ? (
        <span className="rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600">
          共{commonDay.working ? "稼働" : "休業"}
        </span>
      ) : null}
      {day?.note ? (
        <span className="line-clamp-2 text-[10px] leading-tight text-slate-600">{day.note}</span>
      ) : null}
    </>
  );

  if (!canEdit) {
    return <div className={`${CAL_CELL} ${tone} ${dim} ${ring} cursor-default`}>{inner}</div>;
  }
  return (
    <button
      type="submit"
      name="date"
      value={cell.date}
      title="押すたびに 休業日 → 臨時稼働 → 指定なし と変わります"
      className={`${CAL_CELL} ${tone} ${dim} ${ring}`}
    >
      {inner}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      {children}
    </label>
  );
}
