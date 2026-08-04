import type { NextAuthOptions } from "next-auth";

// localhost のクッキーはポートを跨いで共有されるため、既定名（next-auth.session-token）のままだと
// 他のPFアプリの開発サーバーと相互上書きになり JWEDecryptionFailed が起きる。
// アプリ固有のクッキー名にして分離する（本番でも無害）。
// Vercel 上は NEXTAUTH_URL 未設定（VERCEL_URL フォールバック）でも必ず HTTPS。
export const useSecureCookies =
  (process.env.NEXTAUTH_URL ?? "").startsWith("https://") || process.env.VERCEL === "1";
const securePrefix = useSecureCookies ? "__Secure-" : "";

export const SESSION_COOKIE_NAME = `${securePrefix}operation.session-token`;
/** セッション有効期間（next-auth 既定の30日に合わせる） */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * next-auth 設定。
 *
 * このアプリはポータル（pf-portal）からの SSO でしかログインできない（providers は空）。
 * 管理者だけが使う社内アプリなので、アプリ単独のパスワードは持たせず、
 * 認証・権限の正はポータルに一本化する。セッションは JWT（/api/sso が直接発行する）。
 */
export const authOptions: NextAuthOptions = {
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    callbackUrl: {
      name: `${securePrefix}operation.callback-url`,
      options: { sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    csrfToken: {
      // CSRF トークンの既定名は __Host- プレフィックス。他アプリとの衝突回避で名前だけ変える。
      name: `${useSecureCookies ? "__Host-" : ""}operation.csrf-token`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
  },
  providers: [],
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  pages: { signIn: "/login" },
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.id ?? token.sub ?? "");
        session.user.loginId = String(token.loginId ?? "");
        session.user.role = token.role === "admin" ? "admin" : "member";
        session.user.factory = (token.factory as string | null) ?? null;
      }
      return session;
    },
  },
};
