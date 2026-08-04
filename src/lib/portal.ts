/**
 * ポータル（pf-portal）の URL。
 *
 * ログイン導線・ログアウト後の戻り先・お問い合わせリンクで使う。
 * ドメイン移行のときにコードを触らずに済むよう、`NEXT_PUBLIC_PORTAL_URL` で差し替えられる。
 * （クライアントコンポーネントからも参照するため NEXT_PUBLIC_ プレフィックス）
 */
export const PORTAL_URL = (
  process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.paloma-pf.com"
).replace(/\/+$/, "");

/** ポータルのお問い合わせフォーム（このアプリを選択した状態で開く）。 */
export const PORTAL_CONTACT_URL = `${PORTAL_URL}/?contact=operation`;
