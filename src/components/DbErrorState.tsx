import { AlertTriangle } from "lucide-react";

/** DB に繋がらない／初期化前のときの案内。画面を落とさずに原因を伝える。 */
export default function DbErrorState({ message }: { message?: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <div className="mb-1 flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" />
        データを取得できませんでした
      </div>
      <p className="text-xs leading-relaxed">
        {message ??
          "データベースに接続できません。時間をおいて再読み込みしても改善しない場合は、環境変数 DATABASE_URL の設定をご確認ください。"}
      </p>
    </div>
  );
}
