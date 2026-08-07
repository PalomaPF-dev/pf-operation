/**
 * 翌日回しの申請・結果を LINE WORKS で通知する（ポータル経由）。
 *
 * このアプリで承認が要るのは翌日回し(defer)だけで、判断するのは申請者の上長ではなく
 * 生産管理部（マスタ編集権限者）。そのため通知先はこのアプリ側で決めて、
 * ポータルの複数宛て送信（loginIds）に渡す。
 * 残業の実施(do)は承認不要なので通知しない。
 *
 * 仕様は pf-portal の docs/lineworks.md を参照。
 * 通知の失敗で申請を失敗させないこと。呼び出し側は await せず投げっぱなしにする。
 */

const PORTAL_ORIGIN = (process.env.PORTAL_ORIGIN ?? "https://portal.paloma-pf.com").replace(/\/+$/, "");
const APP_KEY = "operation";
const TIMEOUT_MS = 8000;

/** アプリ内のURL（本番URLが分かるときだけ付ける。ローカルは外から開けないので付けない）。 */
function appUrl(path: string): string | undefined {
  const base = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!base.startsWith("https://")) return undefined;
  return `${base.replace(/\/$/, "")}${path}`;
}

function approvalsUrl(): string | undefined {
  return appUrl("/approvals");
}

/**
 * 許可を出す人へ通知する。失敗しても例外を投げない（申請自体は成立させる）。
 * @param approverLoginIds 通知先の社員番号（生産管理部の管理者）。空なら何もしない。
 * @param summary 本文（「〈申請者〉さんから翌日回しの申請が届いています。日付・ライン」など）
 */
export function notifyApprovalRequested(approverLoginIds: string[], summary: string): void {
  send(approverLoginIds, "翌日回しの許可依頼", summary);
}

/**
 * 許可・差し戻しの結果を、申請者と対象工場のメンバーへ通知する。
 * 判断の結果は現場が動くかどうかを左右するため、申請者だけでなく工場全体に届ける。
 */
export function notifyApprovalDecided(
  loginIds: string[],
  approved: boolean,
  summary: string
): void {
  send(loginIds, approved ? "翌日回しが許可されました" : "翌日回しが差し戻されました", summary);
}

/**
 * 入力を促す定期通知（工場・ラインごとの設定時刻に送る）。
 * リンク先は承認画面ではなく入力画面にする。
 */
export function notifyInputReminder(loginIds: string[], summary: string): void {
  send(loginIds, "進捗・残業の入力のお願い", summary, appUrl("/report"));
}

/** ポータルの通知APIへ投げる（重複を除き、失敗しても例外にしない）。 */
function send(loginIds: string[], title: string, summary: string, url?: string): void {
  const key = (process.env.PF_PROVISION_KEY ?? "").trim();
  const to = [...new Set(loginIds.filter(Boolean))];
  if (!key || to.length === 0) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  void fetch(`${PORTAL_ORIGIN}/api/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      loginIds: to,
      app: APP_KEY,
      title,
      message: summary,
      url: url ?? approvalsUrl(),
    }),
    signal: controller.signal,
    cache: "no-store",
  })
    .then(async (r) => {
      if (!r.ok) {
        console.error("[approvalNotify] ポータルが拒否:", r.status, (await r.text().catch(() => "")).slice(0, 200));
        return;
      }
      // 宛先にLINE WORKSが未設定でもポータルは 200 を返す。設定漏れに気付けるよう記録する。
      const d = (await r.json().catch(() => null)) as { sentCount?: number } | null;
      if (d && d.sentCount === 0) {
        console.warn("[approvalNotify] 誰にも届いていません（LINE WORKS未登録の可能性）:", to.join(","));
      }
    })
    .catch((e) => console.error("[approvalNotify] 送信失敗:", e instanceof Error ? e.message : e))
    .finally(() => clearTimeout(timer));
}
