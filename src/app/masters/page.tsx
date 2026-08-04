import Link from "next/link";
import { Lock, Unlock } from "lucide-react";
import { requireAdminSession } from "@/lib/session";
import { isMasterUnlocked, pinConfigured } from "@/lib/masterPin";
import { listFactories, listLines, listWorkers } from "@/lib/db";
import {
  deleteFactoryAction,
  deleteLineAction,
  deleteWorkerAction,
  lockMasterAction,
  saveCapacitiesAction,
  saveFactoryAction,
  saveLineAction,
  saveWorkerAction,
  unlockMasterAction,
} from "@/lib/actions";
import { formatBreaks } from "@/lib/capacity";
import { LINE_TYPE_LABEL, QTY_LABEL, type Factory, type Line, type Worker } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SubmitButton from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "capacity", label: "ライン実力" },
  { key: "lines", label: "ライン設定" },
  { key: "factories", label: "工場" },
  { key: "workers", label: "作業者" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-600 focus:outline-none focus:ring-1 focus:ring-purple-600 disabled:bg-slate-50 disabled:text-slate-500";
const deleteCls =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60";

/**
 * マスタ設定。
 * ライン実力（台/日）・稼働時間（H）は工場ごとに一覧で確認でき、編集は PIN の解除が必要。
 */
export default async function MastersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdminSession();
  const sp = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === sp.tab) ? (sp.tab as TabKey) : "capacity";
  const unlocked = await isMasterUnlocked();
  const locked = !unlocked;

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
        ライン実力（台/日）・稼働時間（H）を工場ごとに確認できます。
        {pinConfigured() ? "編集するにはPINの入力が必要です。" : null}
      </p>

      <PinBar locked={locked} configured={pinConfigured()} />

      <nav className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/masters?tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              t.key === tab
                ? "border-purple-700 text-purple-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "capacity" ? (
        <CapacityTab factories={factories} lines={lines} locked={locked} />
      ) : null}
      {tab === "lines" ? <LinesTab factories={factories} lines={lines} locked={locked} /> : null}
      {tab === "factories" ? <FactoriesTab factories={factories} locked={locked} /> : null}
      {tab === "workers" ? (
        <WorkersTab factories={factories} lines={lines} workers={workers} locked={locked} />
      ) : null}
    </div>
  );
}

/* ===== PIN ロックの操作バー ===== */

function PinBar({ locked, configured }: { locked: boolean; configured: boolean }) {
  if (!configured) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
        <Unlock className="h-4 w-4" />
        PIN（環境変数 MASTER_EDIT_PIN）が未設定のため、編集ロックは無効です。
      </div>
    );
  }
  if (locked) {
    return (
      <form action={unlockMasterAction} className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm text-slate-600">
          <Lock className="h-4 w-4" />
          編集にはPINが必要です
        </span>
        <input
          type="password"
          name="pin"
          placeholder="PIN"
          autoComplete="off"
          required
          className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-purple-600 focus:outline-none focus:ring-1 focus:ring-purple-600"
        />
        <SubmitButton
          pendingLabel="確認中…"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          解除
        </SubmitButton>
      </form>
    );
  }
  return (
    <form action={lockMasterAction} className="mb-4 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-sm text-emerald-700">
        <Unlock className="h-4 w-4" />
        編集できます（2時間で自動的にロックされます）
      </span>
      <SubmitButton
        pendingLabel="処理中…"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        ロックする
      </SubmitButton>
    </form>
  );
}

/* ===== ライン実力（工場ごとの一覧） ===== */

function CapacityTab({
  factories,
  lines,
  locked,
}: {
  factories: Factory[];
  lines: Line[];
  locked: boolean;
}) {
  if (factories.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        先に
        <Link href="/masters?tab=factories" className="mx-1 text-purple-700 underline">
          工場
        </Link>
        を登録してください。
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {factories.map((f) => {
        const group = lines.filter((l) => l.factoryId === f.id);
        return (
          <section key={f.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <h2 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">
              {f.name}
            </h2>
            {group.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                この工場のラインが登録されていません。
              </p>
            ) : (
              <form action={saveCapacitiesAction}>
                <ul className="divide-y divide-slate-100">
                  {group.map((l) => {
                    const unit = QTY_LABEL[l.lineType].unit;
                    return (
                      <li key={l.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                        <input type="hidden" name="lineId" value={l.id} />
                        <span className="w-14 shrink-0 font-bold text-slate-900">{l.name}</span>
                        <input
                          type="number"
                          name={`capacity_${l.id}`}
                          defaultValue={l.capacityPerDay || ""}
                          min={0}
                          step={1}
                          placeholder={`${unit}/日`}
                          disabled={locked}
                          className={`${inputCls} w-28 tabular-nums`}
                        />
                        <span className="text-xs text-slate-500">{unit}/日</span>
                        <input
                          type="number"
                          name={`hours_${l.id}`}
                          defaultValue={l.workHours || ""}
                          min={0}
                          step={0.5}
                          placeholder="H"
                          disabled={locked}
                          className={`${inputCls} w-20 tabular-nums`}
                        />
                        <span className="text-xs text-slate-500">H稼働</span>
                        <input
                          type="text"
                          name={`note_${l.id}`}
                          defaultValue={l.note ?? ""}
                          maxLength={200}
                          placeholder="備考（任意）"
                          disabled={locked}
                          className={`${inputCls} min-w-[12rem] flex-1`}
                        />
                      </li>
                    );
                  })}
                </ul>
                {!locked ? (
                  <div className="border-t border-slate-100 px-4 py-3">
                    <SubmitButton>{f.name}の実力を保存</SubmitButton>
                  </div>
                ) : null}
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ===== ライン設定（種別・始業・休憩など） ===== */

function LineFields({
  factories,
  line,
  locked,
}: {
  factories: Factory[];
  line?: Line;
  locked: boolean;
}) {
  return (
    <>
      <Field label="工場">
        <select
          name="factoryId"
          defaultValue={line?.factoryId ?? factories[0]?.id ?? ""}
          required
          disabled={locked}
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
          disabled={locked}
          className={`${inputCls} w-28`}
        />
      </Field>
      <Field label="種別">
        <select
          name="lineType"
          defaultValue={line?.lineType ?? "assembly"}
          disabled={locked}
          className={`${inputCls} w-32`}
        >
          <option value="assembly">{LINE_TYPE_LABEL.assembly}</option>
          <option value="process">{LINE_TYPE_LABEL.process}</option>
        </select>
      </Field>
      <Field label="ライン実力/日">
        <input
          type="number"
          name="capacityPerDay"
          min={0}
          step={1}
          defaultValue={line?.capacityPerDay ?? 0}
          disabled={locked}
          className={`${inputCls} w-24 text-right tabular-nums`}
        />
      </Field>
      <Field label="稼働(H)">
        <input
          type="number"
          name="workHours"
          min={0}
          step={0.5}
          defaultValue={line?.workHours ?? 8}
          disabled={locked}
          className={`${inputCls} w-20 text-right tabular-nums`}
        />
      </Field>
      <Field label="始業">
        <input
          type="time"
          name="startTime"
          defaultValue={line?.startTime ?? "08:00"}
          disabled={locked}
          className={`${inputCls} w-28`}
        />
      </Field>
      <Field label="休憩（開始-終了）">
        <input
          type="text"
          name="breaks"
          defaultValue={line ? formatBreaks(line.breaks) : "10:00-10:10／12:10-12:50／14:50-15:00"}
          placeholder="10:00-10:10／12:10-12:50"
          disabled={locked}
          className={`${inputCls} w-64`}
        />
      </Field>
      <Field label="標準人数">
        <input
          type="number"
          name="headcount"
          min={0}
          step={0.5}
          defaultValue={line?.headcount ?? 0}
          disabled={locked}
          className={`${inputCls} w-20 text-right tabular-nums`}
        />
      </Field>
      <Field label="表示順">
        <input
          type="number"
          name="sortOrder"
          defaultValue={line?.sortOrder ?? 0}
          disabled={locked}
          className={`${inputCls} w-20 text-right tabular-nums`}
        />
      </Field>
      <Field label="備考">
        <input
          type="text"
          name="note"
          defaultValue={line?.note ?? ""}
          maxLength={200}
          disabled={locked}
          className={`${inputCls} w-48`}
        />
      </Field>
      <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-600">
        <input
          type="checkbox"
          name="active"
          defaultChecked={line?.active ?? true}
          disabled={locked}
          className="h-4 w-4 rounded border-slate-300 text-purple-700 focus:ring-purple-600"
        />
        稼働中
      </label>
    </>
  );
}

function LinesTab({
  factories,
  lines,
  locked,
}: {
  factories: Factory[];
  lines: Line[];
  locked: boolean;
}) {
  if (factories.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        先に
        <Link href="/masters?tab=factories" className="mx-1 text-purple-700 underline">
          工場
        </Link>
        を登録してください。
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {!locked ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">ラインを追加</h2>
          <form action={saveLineAction} className="flex flex-wrap items-end gap-3">
            <LineFields factories={factories} locked={false} />
            <SubmitButton>追加</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            組立ラインは「ライン実力に対して時間当たりで間に合っているか」、前工程は「決められた時刻までに計画された製造指図が消化できているか」を追います。休憩は理論値の計算から差し引かれます。
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
                <LineFields factories={factories} line={l} locked={locked} />
                {!locked ? <SubmitButton>更新</SubmitButton> : null}
              </form>
              {!locked ? (
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

function FactoriesTab({ factories, locked }: { factories: Factory[]; locked: boolean }) {
  return (
    <div className="space-y-4">
      {!locked ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">工場を追加</h2>
          <form action={saveFactoryAction} className="flex flex-wrap items-end gap-3">
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
                <Field label="工場名">
                  <input
                    type="text"
                    name="name"
                    defaultValue={f.name}
                    required
                    maxLength={60}
                    disabled={locked}
                    className={`${inputCls} w-56`}
                  />
                </Field>
                <Field label="表示順">
                  <input
                    type="number"
                    name="sortOrder"
                    defaultValue={f.sortOrder}
                    disabled={locked}
                    className={`${inputCls} w-24 text-right tabular-nums`}
                  />
                </Field>
                {!locked ? <SubmitButton>更新</SubmitButton> : null}
              </form>
              {!locked ? (
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
  locked,
}: {
  factories: Factory[];
  lines: Line[];
  worker?: Worker;
  locked: boolean;
}) {
  return (
    <>
      <Field label="工場">
        <select
          name="factoryId"
          defaultValue={worker?.factoryId ?? factories[0]?.id ?? ""}
          required
          disabled={locked}
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
          disabled={locked}
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
          disabled={locked}
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
          disabled={locked}
          className={`${inputCls} w-40`}
        />
      </Field>
      <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-600">
        <input
          type="checkbox"
          name="active"
          defaultChecked={worker?.active ?? true}
          disabled={locked}
          className="h-4 w-4 rounded border-slate-300 text-purple-700 focus:ring-purple-600"
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
  locked,
}: {
  factories: Factory[];
  lines: Line[];
  workers: Worker[];
  locked: boolean;
}) {
  if (factories.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        先に
        <Link href="/masters?tab=factories" className="mx-1 text-purple-700 underline">
          工場
        </Link>
        を登録してください。
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {!locked ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">作業者を追加</h2>
          <form action={saveWorkerAction} className="flex flex-wrap items-end gap-3">
            <WorkerFields factories={factories} lines={lines} locked={false} />
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
                <WorkerFields factories={factories} lines={lines} worker={w} locked={locked} />
                {!locked ? <SubmitButton>更新</SubmitButton> : null}
              </form>
              {!locked ? (
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
