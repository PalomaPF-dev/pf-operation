import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-bold text-slate-900">ページが見つかりません</h1>
      <p className="mt-2 text-sm text-slate-600">
        URL をご確認ください。
        <Link href="/" className="ml-1 text-purple-700 underline">
          ダッシュボードへ戻る
        </Link>
      </p>
    </div>
  );
}
