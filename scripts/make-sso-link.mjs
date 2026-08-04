/**
 * トライアル用の SSO ログインリンクを作る。
 *
 * このアプリはポータル（pf-portal）の SSO でしかログインできない。
 * ポータル側への登録が済むまでの間、同じ鍵（PF_PROVISION_KEY）で
 * ポータルと同じ形式のトークンを手元で発行し、ログインを試せるようにする。
 *
 *   PF_PROVISION_KEY=xxxx node scripts/make-sso-link.mjs \
 *     --url https://operation.pf-paloma.co.jp \
 *     --login-id 12345 --name "山田 太郎"
 *
 * 出力された URL を60秒以内にブラウザで開くとログインできる。
 * role は既定で admin（このアプリは管理者しか入れないため）。
 * ※ ポータル登録後は、このスクリプトは不要。
 */
import { createHmac } from "node:crypto";

/** --key value 形式の引数を読む。 */
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const key = (process.env.PF_PROVISION_KEY ?? "").trim();
if (!key) {
  console.error("PF_PROVISION_KEY が設定されていません（Vercel に入れたものと同じ値）。");
  process.exit(1);
}

const baseUrl = (arg("url") ?? "http://localhost:3000").replace(/\/+$/, "");
const loginId = arg("login-id");
const name = arg("name") ?? loginId;
const role = arg("role") ?? "admin";
const factory = arg("factory");

if (!loginId) {
  console.error('--login-id を指定してください（例: --login-id 12345 --name "山田 太郎"）。');
  process.exit(1);
}

// ポータルの /api/user?launch=... が発行するものと同じ形のトークン（TTL 60秒）
const payload = Buffer.from(
  JSON.stringify({
    loginId,
    name,
    role,
    ...(factory ? { factory } : {}),
    app: "operation",
    exp: Date.now() + 60_000,
  })
).toString("base64url");
const sig = createHmac("sha256", key).update(payload).digest("hex");

console.log(`${baseUrl}/api/sso?token=${encodeURIComponent(`${payload}.${sig}`)}`);
console.log("");
console.log("↑ 60秒以内に開いてください（期限切れの場合はもう一度実行）。");
