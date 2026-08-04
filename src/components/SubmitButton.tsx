"use client";

import { useFormStatus } from "react-dom";

/** 送信中は二重送信を防ぐ送信ボタン（Server Action 用）。 */
export default function SubmitButton({
  children,
  className,
  pendingLabel = "保存中…",
  confirm,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  /** 指定すると押下時に確認ダイアログを出す（削除など） */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={
        className ??
        "rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
      }
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
