import Image from "next/image";
import { ShieldAlert } from "lucide-react";

export const dynamic = "force-dynamic";

const PORTAL_URL = "https://portal.paloma-pf.com/";

const ERROR_MESSAGE: Record<string, string> = {
  sso: "ログイン情報を確認できませんでした。ポータルからもう一度お入りください。",
  forbidden:
    "このアプリは管理者専用です。利用権限が必要な場合は、ポータルの管理者にお問い合わせください。",
  account: "アカウントが見つかりませんでした。ポータルからもう一度お入りください。",
  config: "サーバー設定が未完了です。システム管理者にお問い合わせください。",
  server: "サーバーエラーが発生しました。時間をおいてお試しください。",
};

/**
 * ログイン画面。
 * このアプリはポータル（pf-portal）の SSO でしかログインできないため、
 * 入力欄は持たず、ポータルへの導線とエラー内容だけを出す。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const message = sp.error ? (ERROR_MESSAGE[sp.error] ?? ERROR_MESSAGE.sso) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f7f5] p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col items-center text-center">
          <Image src="/icon-192.png" alt="" width={48} height={48} className="mb-3 rounded-xl" />
          <p className="text-[11px] tracking-wide text-slate-400">株式会社パロマ</p>
          <h1 className="text-lg font-bold text-slate-900">PF進捗管理</h1>
          <p className="mt-1 text-xs text-slate-500">進捗報告・残業申請（管理者専用）</p>
        </div>

        {message ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        ) : null}

        <p className="mb-4 text-xs leading-relaxed text-slate-600">
          このアプリはポータルからログインします。ポータルでログインし、アプリ一覧から「進捗管理」を選んでください。
        </p>

        <a
          href={PORTAL_URL}
          className="flex w-full items-center justify-center rounded-lg bg-purple-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-800"
        >
          ポータルへ移動
        </a>
      </div>
    </div>
  );
}
