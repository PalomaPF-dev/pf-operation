"use client";

import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  ClipboardList,
  Clock,
  BarChart3,
  Settings,
  LogOut,
  Mail,
} from "lucide-react";
import { AppShell as BaseAppShell, type NavGroup } from "@paloma-pf/ui";

const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ href: "/", label: "ダッシュボード", icon: LayoutDashboard }],
  },
  {
    title: "日々の運用",
    items: [
      { href: "/report", label: "進捗・残業の入力", icon: ClipboardList },
      { href: "/reports", label: "報告履歴", icon: Clock },
    ],
  },
  {
    title: "集計・設定",
    items: [
      { href: "/summary", label: "集計", icon: BarChart3 },
      { href: "/masters", label: "マスタ設定", icon: Settings },
    ],
  },
];

/** 進捗管理のテーマ（茶系）。アプリアイコンのグラデーションと合わせている。 */
const ACCENT = "#6b4426";

/** ログインユーザー表示とログアウト。next-auth 依存のためアプリ側に置く。 */
function UserFooter() {
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <div className="mt-auto border-t border-[#e5e5e5] px-4 py-3">
      <div className="mb-2 truncate text-xs text-[#707070]">
        {session.user.factory ? (
          <>
            {session.user.factory}
            <span className="mx-1 text-slate-300">/</span>
          </>
        ) : null}
        {session.user.name}
      </div>
      <div className="mb-2 text-[10px] leading-snug text-[#909090]">管理者専用アプリ</div>
      <a
        href="https://portal.paloma-pf.com/?contact=operation"
        target="_blank"
        rel="noopener noreferrer"
        className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
      >
        <Mail className="h-4 w-4" />
        お問い合わせ
      </a>
      <button
        onClick={() => {
          void signOut({ redirect: false }).then(() => {
            window.location.href = "https://portal.paloma-pf.com/";
          });
        }}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
      >
        <LogOut className="h-4 w-4" />
        ログアウト
      </button>
    </div>
  );
}

/**
 * 進捗管理のシェル。共通の @paloma-pf/ui の AppShell に、
 * このアプリ固有のナビ・テーマ・ユーザー表示を差し込む。
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <BaseAppShell
      nav={NAV_GROUPS}
      brand={{ eyebrow: "株式会社パロマ", title: "PF進捗管理", subtitle: "進捗報告・残業申請" }}
      accent={ACCENT}
      navIndicator="pill"
      background="#f7f7f5"
      bareRoutes={["/login"]}
      sidebarFooter={<UserFooter />}
    >
      {children}
    </BaseAppShell>
  );
}
