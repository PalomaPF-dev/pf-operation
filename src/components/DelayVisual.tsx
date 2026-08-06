import { formatHours } from "@/lib/format";
import { QTY_LABEL, REASON_LABEL, type Report } from "@/lib/types";

/**
 * 「なぜ遅れたのか」をひと目で掴むための図。
 *
 * 翌日回しの許可（生産管理部）では、数字の羅列より
 * ・計画に対してどこまで出来ているか
 * ・その時刻の理論値にどれだけ足りないか
 * ・どの時間帯から遅れ始めたか
 * が要る。計画を全幅とした帯に実績を塗り、理論値の位置に印を立てて、
 * その日の報告の推移を並べる。
 */
export default function DelayVisual({
  report: r,
  history,
}: {
  report: Report;
  /** その日の同一ラインの全報告（時刻の昇順）。1件しかなければ推移は出さない */
  history?: Report[];
}) {
  const unit = QTY_LABEL[r.lineType].unit;
  const shortage = Math.max(0, r.theoreticalQty - r.actualQty);
  const remaining = Math.max(0, r.plannedQty - r.actualQty);
  // 帯の全幅は「計画数」。理論値が計画を超える場合に印が外へ出ないよう上限を取る
  const scale = Math.max(r.plannedQty, r.theoreticalQty, r.actualQty, 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {/* ===== 遅れの大きさ ===== */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xs text-slate-600">この時点の遅れ</span>
        <span className="text-xl font-bold tabular-nums text-rose-600">
          −{shortage}
          <span className="ml-0.5 text-sm font-medium">{unit}</span>
        </span>
        <span className="text-xs text-slate-600">
          理論 {r.theoreticalQty}
          {unit} に対して実績 {r.actualQty}
          {unit}
          {r.theoreticalQty > 0
            ? `（達成率 ${Math.round((r.actualQty / r.theoreticalQty) * 100)}%）`
            : ""}
        </span>
        <span className="ml-auto text-xs text-slate-600">
          本日計画 {r.plannedQty}
          {unit} に対して残り
          <strong className="ml-1 tabular-nums text-slate-900">
            {remaining}
            {unit}
          </strong>
        </span>
      </div>

      {/* ===== 帯グラフ（計画を全幅・実績を塗り・理論値に印） ===== */}
      <div className="relative mt-2 h-6 w-full rounded-md bg-white ring-1 ring-slate-200">
        {/* 実績 */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-md bg-brand-600"
          style={{ width: pct(r.actualQty) }}
        />
        {/* 理論値までの不足ぶん（実績〜理論値をハッチで見せる） */}
        {shortage > 0 ? (
          <div
            className="absolute inset-y-0 bg-rose-200"
            style={{
              left: pct(r.actualQty),
              width: `calc(${pct(r.theoreticalQty)} - ${pct(r.actualQty)})`,
            }}
          />
        ) : null}
        {/* 理論値の位置に印 */}
        <div
          className="absolute inset-y-0 w-0.5 bg-rose-600"
          style={{ left: pct(r.theoreticalQty) }}
          aria-hidden
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-brand-600" />
          実績 {r.actualQty}
          {unit}
        </span>
        {shortage > 0 ? (
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-rose-200" />
            不足 {shortage}
            {unit}
          </span>
        ) : null}
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 bg-rose-600" />
          {r.reportTime} 時点の理論値
        </span>
        <span className="ml-auto">全幅＝本日計画 {r.plannedQty}{unit}</span>
      </div>

      {/* ===== 理由 ===== */}
      {r.reasonCode || r.reason ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {r.reasonCode ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
              {REASON_LABEL[r.reasonCode]}
            </span>
          ) : null}
          {r.reason ? <p className="text-sm text-slate-700">{r.reason}</p> : null}
        </div>
      ) : null}

      {/* ===== その日の推移（どの時間帯から遅れたか） ===== */}
      {history && history.length > 1 ? (
        <div className="mt-3 border-t border-slate-200 pt-2">
          <p className="mb-1 text-[11px] font-medium text-slate-600">当日の推移</p>
          <ul className="space-y-1">
            {history.map((h) => {
              const gap = h.theoreticalQty - h.actualQty;
              const w = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
              return (
                <li key={h.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-10 shrink-0 tabular-nums text-slate-500">{h.reportTime}</span>
                  <span className="relative h-2.5 flex-1 rounded bg-white ring-1 ring-slate-200">
                    <span
                      className={`absolute inset-y-0 left-0 rounded ${
                        gap > 0 ? "bg-rose-400" : "bg-emerald-400"
                      }`}
                      style={{ width: w(h.actualQty) }}
                    />
                    <span
                      className="absolute inset-y-0 w-px bg-slate-400"
                      style={{ left: w(h.theoreticalQty) }}
                      aria-hidden
                    />
                  </span>
                  <span className="w-28 shrink-0 text-right tabular-nums text-slate-600">
                    {h.actualQty}/{h.theoreticalQty}
                    {unit}
                  </span>
                  <span
                    className={`w-16 shrink-0 text-right tabular-nums font-medium ${
                      gap > 0 ? "text-rose-600" : "text-emerald-600"
                    }`}
                  >
                    {gap > 0 ? `−${gap}` : `+${-gap}`}
                  </span>
                  <span className="w-24 shrink-0 text-right text-slate-500">
                    {h.overtimeManMinutes > 0 ? `残業 ${formatHours(h.overtimeManMinutes)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
