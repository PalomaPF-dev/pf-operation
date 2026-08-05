import Link from "next/link";
import { Info } from "lucide-react";
import { masterEditDepartments, requireAdminSession } from "@/lib/session";
import { listFactories, listLines, listWorkers } from "@/lib/db";
import {
  deleteFactoryAction,
  deleteLineAction,
  deleteWorkerAction,
  saveCapacitiesAction,
  saveFactoryAction,
  saveLineAction,
  saveWorkerAction,
} from "@/lib/actions";
import { formatBreaks } from "@/lib/capacity";
import {
  LINE_TYPE_LABEL,
  QTY_LABEL,
  capacityPerManHour,
  type Factory,
  type Line,
  type Worker,
} from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SubmitButton from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "capacity", label: "工場・ラインマスター" },
  { key: "lines", label: "ライン設定" },
  { key: "factories", label: "工場" },
  { key: "workers", label: "作業者" },
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
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireAdminSession();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "capacity";
  // 編集可否はページでもサーバーアクションでも判定する（画面はボタンを出さないだけ）
  const canEdit = session.canEditMaster;

  let factories, lines, workers;
  try {
    [factories, lines, workers] = await Promise.all([listFactories(), listLines(), listWorkers()]);
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
            の管理者のみです。
          </span>
        </div>
      ) : null}

      <nav className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/masters?tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              t.key === tab
                ? "border-brand-700 text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "capacity" ? (
        <MasterTable factories={factories} lines={lines} canEdit={canEdit} />
      ) : null}
      {tab === "lines" ? <LinesTab factories={factories} lines={lines} canEdit={canEdit} /> : null}
      {tab === "factories" ? <FactoriesTab factories={factories} canEdit={canEdit} /> : null}
      {tab === "workers" ? (
        <WorkersTab factories={factories} lines={lines} workers={workers} canEdit={canEdit} />
      ) : null}
    </div>
  );
}

/* ===== 工場・ラインマスター（工場ごとの表） ===== */

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
            <th className={TH}>器種</th>
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
                        className={`${inputCls} w-full min-w-[10rem]`}
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
                    confirm={`「${f.name}」を削除します。配下のライン・作業者・報告も削除されます。よろしいですか？`}
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

/* ===== 作業者 ===== */

function WorkerFields({
  factories,
  lines,
  worker,
  canEdit,
}: {
  factories: Factory[];
  lines: Line[];
  worker?: Worker;
  canEdit: boolean;
}) {
  const disabled = !canEdit;
  return (
    <>
      <Field label="工場">
        <select
          name="factoryId"
          defaultValue={worker?.factoryId ?? factories[0]?.id ?? ""}
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
      <Field label="所属ライン（任意）">
        <select
          name="lineId"
          defaultValue={worker?.lineId ?? ""}
          disabled={disabled}
          className={`${inputCls} w-48`}
        >
          <option value="">未設定</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.factoryName} / {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="社員番号">
        <input
          type="text"
          name="employeeNo"
          defaultValue={worker?.employeeNo ?? ""}
          required
          maxLength={32}
          disabled={disabled}
          className={`${inputCls} w-32`}
        />
      </Field>
      <Field label="氏名">
        <input
          type="text"
          name="name"
          defaultValue={worker?.name ?? ""}
          required
          maxLength={60}
          disabled={disabled}
          className={`${inputCls} w-40`}
        />
      </Field>
      <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-600">
        <input
          type="checkbox"
          name="active"
          defaultChecked={worker?.active ?? true}
          disabled={disabled}
          className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
        />
        在籍
      </label>
    </>
  );
}

function WorkersTab({
  factories,
  lines,
  workers,
  canEdit,
}: {
  factories: Factory[];
  lines: Line[];
  workers: Worker[];
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
          <h2 className="mb-3 text-sm font-semibold text-slate-900">作業者を追加</h2>
          <form action={saveWorkerAction} className="flex flex-wrap items-end gap-3">
            <WorkerFields factories={factories} lines={lines} canEdit />
            <SubmitButton>追加</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            ここで登録した作業者が、残業の対象者として選べるようになります。
          </p>
        </section>
      ) : null}

      {workers.length === 0 ? (
        <p className="text-sm text-slate-500">作業者がまだ登録されていません。</p>
      ) : (
        <ul className="space-y-2">
          {workers.map((w) => (
            <li key={w.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <form action={saveWorkerAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={w.id} />
                <WorkerFields factories={factories} lines={lines} worker={w} canEdit={canEdit} />
                {canEdit ? <SubmitButton>更新</SubmitButton> : null}
              </form>
              {canEdit ? (
                <form action={deleteWorkerAction} className="mt-2">
                  <input type="hidden" name="id" value={w.id} />
                  <SubmitButton
                    pendingLabel="削除中…"
                    confirm={`「${w.name}」を削除します。よろしいですか？（残業の記録に含まれている場合は削除できません）`}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      {children}
    </label>
  );
}
