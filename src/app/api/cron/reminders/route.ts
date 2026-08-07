import { listDueReminders, listUnreportedLines, markReminderSent } from "@/lib/db";
import { listFactoryMemberLoginIds } from "@/lib/authDb";
import { notifyInputReminder } from "@/lib/approvalNotify";
import { minutesToTime, nowJstMinutes, todayString } from "@/lib/format";
import { formatWeekdays } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 入力を促す定期通知（Vercel Cron から定期的に呼ばれる）。
 *
 * マスタ設定「定期通知」で工場・ラインごとに決めた時刻に、
 * まだ報告が無ければ LINE WORKS へ「進捗・残業の入力のお願い」を送る。
 *
 * 予定時刻ちょうどには呼ばれないため、
 * 「予定時刻を過ぎていて、まだ今日送っていないもの」を WINDOW_MINUTES 以内で拾う。
 * 昼に止まっていた分を夜に送ってしまわないよう、古すぎる予定は諦める。
 *
 * CRON_SECRET が設定されていれば Authorization: Bearer で認証する
 * （Vercel Cron が自動で付ける。外部のスケジューラから叩くときも同じヘッダを付ける）。
 */

/** 予定時刻から何分前までさかのぼって拾うか。cron の間隔より十分に長くする。 */
const WINDOW_MINUTES = 45;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  }

  const today = todayString();
  const nowTime = minutesToTime(nowJstMinutes());
  // 曜日は JST の日付から出す（UTC で解釈すると1日ずれる）
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();

  let checked = 0;
  let sent = 0;
  let skipped = 0;
  try {
    const due = await listDueReminders({ today, weekday, nowTime, windowMinutes: WINDOW_MINUTES });
    for (const r of due) {
      checked++;
      // 報告済みなら促さない（設定で無効にもできる）
      const unreported = await listUnreportedLines(r.factoryId, r.lineId, today);
      if (r.skipIfReported && unreported.length === 0) {
        // 送らなかった日も記録して、同じ日に何度も判定し直さないようにする
        await markReminderSent(r.id, today);
        skipped++;
        continue;
      }

      const to =
        r.recipients.length > 0 ? r.recipients : await listFactoryMemberLoginIds(r.factoryName);
      if (to.length === 0) {
        await markReminderSent(r.id, today);
        console.warn("[cron/reminders] 宛先がいません:", r.factoryName, r.remindTime);
        continue;
      }

      const target = r.lineName ? `${r.factoryName} / ${r.lineName}` : r.factoryName;
      const lines =
        r.lineName || unreported.length === 0
          ? ""
          : `\n未報告：${unreported.slice(0, 12).join("・")}` +
            (unreported.length > 12 ? ` ほか${unreported.length - 12}ライン` : "");
      notifyInputReminder(
        to,
        `${r.remindTime} の進捗・残業の入力をお願いします。\n${target}${lines}` +
          (r.message ? `\n${r.message}` : "")
      );
      await markReminderSent(r.id, today);
      sent++;
    }
  } catch (e) {
    console.error("[cron/reminders]", e);
    return Response.json({ ok: false, checked, sent, skipped }, { status: 500 });
  }

  console.log(`[cron/reminders] ${nowTime}（${formatWeekdays([weekday])}） 対象${checked} 送信${sent} 省略${skipped}`);
  return Response.json({ ok: true, time: nowTime, checked, sent, skipped });
}
