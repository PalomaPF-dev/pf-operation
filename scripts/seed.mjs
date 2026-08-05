/**
 * 工場・ラインマスタの投入（冪等）。
 *
 * 生産管理部から受領した「工場・ラインマスター」（4工場33ライン）をそのまま登録する。
 * 既にある行は上書きするので、何度実行しても同じ状態になる。
 *
 *   export DATABASE_URL='postgres://...'
 *   node scripts/seed.mjs
 *   node scripts/seed.mjs --with-sample-workers
 *
 * テーブルはアプリが初回アクセス時に作る（src/lib/schema.ts の ensureSchema）。
 * 先に一度ログインしてから実行すること。未作成のときはその旨を出して終了する。
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL が設定されていません。");
  process.exit(1);
}
const sql = neon(url);

/**
 * 取り込むデータは画面の「受領マスタを取り込む」と同じ src/data/factoryLines.json。
 * headcount は現状人員、capacityPerDay は生産能力（台/日）、workHours は総稼働時間（H）。
 * 実力が未記入のライン（清洲 #8）は 0 のまま登録し、画面で埋めてもらう。
 */
import { readFileSync } from "node:fs";

const DATA = JSON.parse(
  readFileSync(new URL("../src/data/factoryLines.json", import.meta.url), "utf8")
);
const FACTORIES = DATA.factories;
/** 始業と休憩の既定値（理論値の計算に使う）。ラインごとの実態は画面で直せる。 */
const START_TIME = DATA.startTime;
const BREAKS = DATA.breaks;

/** 残業申請を試すためのサンプル作業者（--with-sample-workers のときだけ）。 */
const SAMPLE_WORKERS = [
  { factory: "清洲工場", employeeNo: "90001", name: "サンプル 一郎", line: "#1" },
  { factory: "清洲工場", employeeNo: "90002", name: "サンプル 二郎", line: "#1" },
  { factory: "清洲工場", employeeNo: "90003", name: "サンプル 三郎", line: "#2" },
  { factory: "清洲工場", employeeNo: "90004", name: "サンプル 四郎", line: "#2" },
  { factory: "清洲工場", employeeNo: "90005", name: "サンプル 五郎", line: null },
];

async function main() {
  // テーブルが無いうちに走らせても意味が分からないエラーになるので、先に確認する
  const [{ exists }] = await sql`SELECT to_regclass('op_lines') IS NOT NULL AS exists`;
  if (!exists) {
    console.error(
      "テーブルがまだありません。先にアプリにログインしてください（初回アクセス時に作成されます）。"
    );
    process.exit(1);
  }

  const factoryIds = new Map();
  let factoryOrder = 0;
  for (const f of FACTORIES) {
    factoryOrder += 10;
    const rows = await sql`
      INSERT INTO op_factories (name, code, sort_order)
      VALUES (${f.name}, ${f.code}, ${factoryOrder})
      ON CONFLICT (name) DO UPDATE SET
        code = EXCLUDED.code, sort_order = EXCLUDED.sort_order
      RETURNING id`;
    const factoryId = rows[0].id;
    factoryIds.set(f.name, factoryId);
    console.log(`${f.code} ${f.name}`);

    let order = 0;
    for (const line of f.lines) {
      order += 10;
      const lineRows = await sql`
        INSERT INTO op_lines
          (factory_id, name, product, line_type, capacity_per_day, work_hours, start_time,
           headcount, note, active, sort_order)
        VALUES
          (${factoryId}, ${line.name}, ${line.product}, 'assembly', ${line.capacityPerDay}, ${line.workHours},
           ${START_TIME}, ${line.headcount}, ${line.note ?? null}, true, ${order})
        ON CONFLICT (factory_id, name) DO UPDATE SET
          product          = EXCLUDED.product,
          capacity_per_day = EXCLUDED.capacity_per_day,
          work_hours       = EXCLUDED.work_hours,
          start_time       = EXCLUDED.start_time,
          headcount        = EXCLUDED.headcount,
          note             = EXCLUDED.note,
          sort_order       = EXCLUDED.sort_order
        RETURNING id`;
      const lineId = lineRows[0].id;

      // 休憩は入れ直す（理論値の前提が変わらないように毎回そろえる）
      await sql`DELETE FROM op_line_breaks WHERE line_id = ${lineId}`;
      await sql`
        INSERT INTO op_line_breaks (line_id, start_time, end_time)
        SELECT ${lineId}::uuid, x.s::time, x.e::time
        FROM unnest(${BREAKS.map((b) => b[0])}::text[], ${BREAKS.map((b) => b[1])}::text[]) AS x(s, e)`;

      const perManHour =
        line.headcount > 0 && line.workHours > 0
          ? (line.capacityPerDay / (line.headcount * line.workHours)).toFixed(2)
          : "-";
      console.log(
        `  ${line.name.padEnd(3)} ${(line.product ?? "").padEnd(16)} ` +
          `${line.headcount}人 ${line.capacityPerDay}台/日 ${line.workHours}H → ${perManHour}台/人・H`
      );
    }
  }

  if (process.argv.includes("--with-sample-workers")) {
    for (const w of SAMPLE_WORKERS) {
      const factoryId = factoryIds.get(w.factory);
      if (!factoryId) continue;
      const lineRows = w.line
        ? await sql`SELECT id FROM op_lines WHERE factory_id = ${factoryId} AND name = ${w.line} LIMIT 1`
        : [];
      await sql`
        INSERT INTO op_workers (factory_id, line_id, employee_no, name, active)
        VALUES (${factoryId}, ${lineRows[0]?.id ?? null}, ${w.employeeNo}, ${w.name}, true)
        ON CONFLICT (factory_id, employee_no) DO UPDATE SET
          name = EXCLUDED.name, line_id = EXCLUDED.line_id`;
    }
    console.log("");
    console.log(`サンプル作業者 ${SAMPLE_WORKERS.length}名を登録しました（本番前に削除してください）。`);
  }

  console.log("");
  console.log("完了。マスタ設定 → 工場・ラインマスター で内容を確認できます。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
