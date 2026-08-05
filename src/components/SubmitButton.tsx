"use client";

import { useFormStatus } from "react-dom";

/** 送信中は二重送信を防ぐ送信ボタン（Server Action 用）。 */
export default function SubmitButton({
  children,
  className,
  pendingLabel = "保存中…",
  confirm,
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  /** 指定すると押下時に確認ダイアログを出す（削除など） */
  confirm?: string;
  /** 同じフォームに複数の送信ボタンを置くとき（承認／差し戻しなど）の識別用 */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={
        className ??
        "rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
      }
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
