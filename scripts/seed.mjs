/**
 * トライアル用のマスタ投入（冪等）。
 *
 * 画面サンプルにあった清洲工場のライン実力をそのまま登録する。
 * 既にある行は上書きするので、何度実行しても同じ状態になる。
 *
 *   DATABASE_URL=postgres://... node scripts/seed.mjs
 *   DATABASE_URL=postgres://... node scripts/seed.mjs --with-sample-workers
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

const FACTORY = "清洲工場";

/** 画面サンプルのライン実力（台/日）と稼働時間（H）。実力が未記入のラインは 0 で登録する。 */
const LINES = [
  { name: "#1", capacity: 412, hours: 8 },
  { name: "#2", capacity: 285, hours: 8, note: "※計画は348台/日（ライン準備・残業状況により変動）" },
  { name: "#3", capacity: 270, hours: 8 },
  { name: "#4", capacity: 380, hours: 8 },
  { name: "#5", capacity: 328, hours: 8 },
  { name: "#8", capacity: 0, hours: 0 },
  { name: "#B", capacity: 280, hours: 8 },
  { name: "#C", capacity: 280, hours: 8 },
  { name: "#D", capacity: 120, hours: 8 },
  { name: "#E", capacity: 120, hours: 6 },
  { name: "#F", capacity: 25, hours: 8 },
  { name: "#G", capacity: 12, hours: 2 },
];

/** 画面サンプルの前提（始業と休憩）。 */
const START_TIME = "08:00";
const BREAKS = [
  ["10:00", "10:10"],
  ["12:10", "12:50"],
  ["14:50", "15:00"],
];

/** 残業申請を試すためのサンプル作業者（--with-sample-workers のときだけ）。 */
const SAMPLE_WORKERS = [
  { employeeNo: "90001", name: "サンプル 一郎", line: "#1" },
  { employeeNo: "90002", name: "サンプル 二郎", line: "#1" },
  { employeeNo: "90003", name: "サンプル 三郎", line: "#2" },
  { employeeNo: "90004", name: "サンプル 四郎", line: "#2" },
  { employeeNo: "90005", name: "サンプル 五郎", line: null },
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

  const factoryRows = await sql`
    INSERT INTO op_factories (name, sort_order) VALUES (${FACTORY}, 10)
    ON CONFLICT (name) DO UPDATE SET sort_order = EXCLUDED.sort_order
    RETURNING id`;
  const factoryId = factoryRows[0].id;
  console.log(`工場: ${FACTORY}`);

  let order = 0;
  for (const line of LINES) {
    order += 10;
    const rows = await sql`
      INSERT INTO op_lines
        (factory_id, name, line_type, capacity_per_day, work_hours, start_time, headcount, note, active, sort_order)
      VALUES
        (${factoryId}, ${line.name}, 'assembly', ${line.capacity}, ${line.hours},
         ${START_TIME}, 0, ${line.note ?? null}, true, ${order})
      ON CONFLICT (factory_id, name) DO UPDATE SET
        capacity_per_day = EXCLUDED.capacity_per_day,
        work_hours       = EXCLUDED.work_hours,
        start_time       = EXCLUDED.start_time,
        note             = EXCLUDED.note,
        sort_order       = EXCLUDED.sort_order
      RETURNING id`;
    const lineId = rows[0].id;

    // 休憩は入れ直す（理論値の前提が変わらないように毎回そろえる）
    await sql`DELETE FROM op_line_breaks WHERE line_id = ${lineId}`;
    await sql`
      INSERT INTO op_line_breaks (line_id, start_time, end_time)
      SELECT ${lineId}::uuid, x.s::time, x.e::time
      FROM unnest(${BREAKS.map((b) => b[0])}::text[], ${BREAKS.map((b) => b[1])}::text[]) AS x(s, e)`;
    console.log(`  ${line.name}: ${line.capacity}台/日 / ${line.hours}H稼働`);
  }

  if (process.argv.includes("--with-sample-workers")) {
    for (const w of SAMPLE_WORKERS) {
      const lineRows = w.line
        ? await sql`SELECT id FROM op_lines WHERE factory_id = ${factoryId} AND name = ${w.line} LIMIT 1`
        : [];
      await sql`
        INSERT INTO op_workers (factory_id, line_id, employee_no, name, active)
        VALUES (${factoryId}, ${lineRows[0]?.id ?? null}, ${w.employeeNo}, ${w.name}, true)
        ON CONFLICT (factory_id, employee_no) DO UPDATE SET
          name = EXCLUDED.name, line_id = EXCLUDED.line_id`;
    }
    console.log(`サンプル作業者 ${SAMPLE_WORKERS.length}名を登録しました（本番前に削除してください）。`);
  }

  console.log("");
  console.log("完了。マスタ設定 → ライン設定 で「標準人数」を入れると、一人当たり出来高が出ます。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
