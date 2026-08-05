import { redirect } from "next/navigation";

/**
 * アプリの入口。立ち上げてすぐ進捗・残業の入力に入れるよう、入力画面へ送る。
 * ダッシュボード（全ラインの一覧）は /dashboard に移した（ナビの「集計・設定」から開く）。
 */
export default function Home() {
  redirect("/report");
}
