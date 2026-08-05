import Image from "next/image";
import { ShieldAlert } from "lucide-react";
import { PORTAL_URL } from "@/lib/portal";

export const dynamic = "force-dynamic";

const ERROR_MESSAGE: Record<string, string> = {
  sso: "ログイン情報を確認できませんでした。ポータルからもう一度お入りください。",
  forbidden:
    "このアプリは管理者専用です。利用権限が必要な場合は、ポータルの管理者にお問い合わせください。",
  account: "アカウントが見つかりませんでした。ポータルからもう一度お入りください。",
  config: "サーバー設定が未完了です。システム管理者にお問い合わせください。",
  db: "データベースに接続できませんでした。環境変数 DATABASE_URL の設定をご確認ください。",
  server: "サーバーエラーが発生しました。時間をおいてお試しください。",
};

/**
 * ログイン画面。
 *
 * 見た目は PFシリーズ共通のログイン画面（上部のアクセントライン＋中央のカード＋
 * アイコン・部門名・アプリ名の見出し）に合わせている。
 * ただしこのアプリはポータル（pf-portal）の SSO でしかログインできないため、
 * 社員番号・パスワードの入力欄は持たず、ポータルへの導線だけを置く。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const message = sp.error ? (ERROR_MESSAGE[sp.error] ?? ERROR_MESSAGE.sso) : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f7f5]">
      <div className="h-1 shrink-0 bg-brand-700" />
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[#e5e5e5] bg-white px-8 py-8">
            <div className="mb-6 flex flex-col items-center text-center">
              <Image
                src="/icon-192.png"
                alt=""
                width={64}
                height={64}
                className="mx-auto mb-3 h-16 w-16 rounded-2xl"
              />
              <p className="text-xs tracking-wide text-[#707070]">生産・調達統括本部</p>
              <h1 className="text-xl font-bold text-[#333333]">PF進捗管理</h1>
              <p className="mt-1 text-xs text-[#707070]">進捗報告・残業申請（管理者専用）</p>
            </div>

            {message ? (
              <div className="mb-4 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{message}</span>
              </div>
            ) : null}

            <h2 className="mb-6 text-lg font-semibold text-[#333333] after:mt-2 after:block after:h-[3px] after:w-8 after:rounded-full after:bg-brand-700 after:content-['']">
              ログイン
            </h2>

            <p className="mb-4 text-sm leading-relaxed text-[#555555]">
              このアプリはポータルからログインします。ポータルでログインし、アプリ一覧から「進捗管理」を選んでください。
            </p>

            <a
              href={PORTAL_URL}
              className="block w-full rounded-lg bg-brand-700 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-800"
            >
              ポータルから一括ログイン
            </a>
            <p className="mt-1 text-center text-xs text-[#707070]">
              ポータルでログインすると各アプリは自動でログインされます
            </p>

            <div className="mt-4 rounded-lg border border-brand-700/40 bg-brand-50 px-3 py-2.5 text-center text-sm text-[#555555]">
              利用できるのは<span className="font-semibold">管理者</span>のみです
              <p className="mt-1 text-xs text-[#707070]">
                権限が必要な場合はポータルの管理者にご依頼ください
              </p>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-[#707070]">
            生産ラインの進捗を決められた時刻に記録し、残業の申請と一人当たり出来高の検証まで行う社内ツール
          </p>
          <div className="mt-3 text-center">
            <a
              href={PORTAL_URL}
              className="text-sm text-[#707070] transition-colors hover:text-brand-700"
            >
              ← ポータルへ戻る
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
