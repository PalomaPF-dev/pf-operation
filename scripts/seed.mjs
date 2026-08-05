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
 * 工場コード・工場名と、その配下のライン。
 * headcount は現状人員、capacity は生産能力（台/日）、hours は総稼働時間（H）。
 * 実力が未記入のライン（清洲 #8）は 0 のまま登録し、画面で埋めてもらう。
 */
const FACTORIES = [
  {
    code: "02",
    name: "大口工場",
    lines: [
      { name: "#2", product: "ブライツ", headcount: 35, capacity: 540, hours: 8 },
      { name: "#3", product: "ブライツ", headcount: 34, capacity: 540, hours: 8 },
      { name: "#5", product: "全一次", headcount: 7, capacity: 80, hours: 8 },
      { name: "#6", product: "PH潜熱", headcount: 9, capacity: 100, hours: 8 },
      { name: "#7", product: "据置(ブライツ)", headcount: 8, capacity: 80, hours: 8 },
      { name: "#A", product: "スリム", headcount: 6, capacity: 50, hours: 8 },
      { name: "#B", product: "FE/FF", headcount: 9, capacity: 145, hours: 8 },
      { name: "#C", product: "Tino", headcount: 1, capacity: 10, hours: 8 },
      { name: "#D", product: "DH", headcount: 1, capacity: 3, hours: 8,
        note: "※機種変更" },
    ],
  },
  {
    code: "0E",
    name: "清洲工場",
    lines: [
      { name: "#1", product: "片面ホーロー", headcount: 18, capacity: 412, hours: 8 },
      { name: "#2", product: "片面ホーロー", headcount: 13, capacity: 285, hours: 8,
        note: "※計画は348台/日　ライン準備できてない残業もできるときのみしかやってない" },
      { name: "#3", product: "ブリリオ/リプラ/両面ホーロー", headcount: 15, capacity: 270, hours: 8 },
      { name: "#4", product: "ブリリオ/リプラ/両面ホーロー", headcount: 18, capacity: 380, hours: 8 },
      { name: "#8", product: "別梱トッププレート", headcount: 0, capacity: 0, hours: 0 },
      { name: "#5", product: "フェイシス/ウィズナ", headcount: 19, capacity: 328, hours: 8 },
      { name: "#B", product: "59cmハイグレード", headcount: 11, capacity: 280, hours: 8 },
      { name: "#C", product: "二口G無し", headcount: 7, capacity: 280, hours: 8 },
      { name: "#D", product: "二口G有し", headcount: 6, capacity: 120, hours: 8 },
      { name: "#E", product: "一口/縦二口", headcount: 5, capacity: 120, hours: 6,
        note: "※＃Gと＃Eは同一人員にて生産" },
      { name: "#F", product: "オーブン", headcount: 6, capacity: 25, hours: 8 },
      { name: "#G", product: "クレア", headcount: 5, capacity: 12, hours: 2,
        note: "※＃Gと＃Eは同一人員にて生産" },
    ],
  },
  {
    code: "05",
    name: "直方工場",
    lines: [
      { name: "#1", product: "小型", headcount: 14, capacity: 540, hours: 8 },
      { name: "#2", product: "AW", headcount: 20, capacity: 400, hours: 8 },
      { name: "#3", product: "AW", headcount: 13, capacity: 330, hours: 8 },
      { name: "#5", product: "4桁", headcount: 28, capacity: 450, hours: 8 },
      { name: "#4", product: "輸出28号", headcount: 5, capacity: 50, hours: 8 },
      { name: "#6", product: "輸出28号", headcount: 31, capacity: 475, hours: 8 },
      { name: "#7", product: "32号(輸出32号)", headcount: 14, capacity: 200, hours: 8 },
    ],
  },
  {
    code: "0T",
    name: "恵那工場",
    lines: [
      { name: "#2", product: "56cm", headcount: 14, capacity: 680, hours: 8 },
      { name: "#4", product: "59cm", headcount: 17, capacity: 670, hours: 8 },
      { name: "#5", product: "59cm", headcount: 14, capacity: 560, hours: 8 },
      { name: "#6", product: "二口", headcount: 6, capacity: 120, hours: 3,
        note: "※＃6と＃7は同一人員にて生産" },
      { name: "#7", product: "一口", headcount: 6, capacity: 150, hours: 3,
        note: "※＃6と＃7は同一人員にて生産" },
    ],
  },
];

/** 始業と休憩の既定値（理論値の計算に使う）。ラインごとの実態は画面で直せる。 */
const START_TIME = "08:00";
const BREAKS = [
  ["10:00", "10:10"],
  ["12:10", "12:50"],
  ["14:50", "15:00"],
];

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
          (${factoryId}, ${line.name}, ${line.product}, 'assembly', ${line.capacity}, ${line.hours},
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
        line.headcount > 0 && line.hours > 0
          ? (line.capacity / (line.headcount * line.hours)).toFixed(2)
          : "-";
      console.log(
        `  ${line.name.padEnd(3)} ${(line.product ?? "").padEnd(16)} ` +
          `${line.headcount}人 ${line.capacity}台/日 ${line.hours}H → ${perManHour}台/人・H`
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
