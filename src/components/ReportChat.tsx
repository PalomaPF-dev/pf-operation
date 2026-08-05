"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send } from "lucide-react";

/**
 * 報告1件ぶんの連絡欄（申請者と承認者のやり取り）。
 *
 * 履歴はポータルに集約されていて、ここは /api/chat 経由で読み書きする
 * （中継が要る理由は src/app/api/chat/route.ts のコメント参照）。
 * 新しい発言は相手の LINE WORKS へ自動通知される。
 *
 * 既定は閉じた状態で、件数だけ出す。承認画面に長い会話を常時開くと
 * 本来の「承認待ちを捌く」動線が埋もれるため。
 */

interface ChatMessage {
  id: string;
  loginId: string;
  name: string;
  body: string;
  createdAt: string;
  mine: boolean;
}

const POLL_MS = 15000;

/** 同日なら時刻だけ、別日なら日付も。JST 固定（format.ts と同じ方針）。 */
function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jst = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
  const now = new Date();
  const nowJst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000);
  const hm = `${String(jst.getHours()).padStart(2, "0")}:${String(jst.getMinutes()).padStart(2, "0")}`;
  const sameDay =
    jst.getFullYear() === nowJst.getFullYear() &&
    jst.getMonth() === nowJst.getMonth() &&
    jst.getDate() === nowJst.getDate();
  return sameDay ? hm : `${jst.getMonth() + 1}/${jst.getDate()} ${hm}`;
}

/**
 * 発言中の http(s) URL だけリンクにする。
 * React が本文をテキストとして描画するので、ここで HTML を組み立てないこと
 * （dangerouslySetInnerHTML を使わなければエスケープ漏れは起きない）。
 */
function renderBody(body: string) {
  const parts = body.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a
        key={i}
        href={p}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-700 underline break-all"
      >
        {p}
      </a>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

export default function ReportChat({
  reportId,
  title,
  className,
}: {
  /** 対象の報告ID（ポータル側のスレッドキー） */
  reportId: string;
  /** スレッド名。LINE WORKS 通知の見出しにも使われる */
  title: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const call = useCallback(
    async (payload: Record<string, unknown>) => {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, ref: reportId, title }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.message ?? `通信に失敗しました (${r.status})`);
      return data;
    },
    [reportId, title]
  );

  const load = useCallback(
    async (first: boolean) => {
      try {
        const d = await call({ action: "list" });
        const list: ChatMessage[] = Array.isArray(d?.messages) ? d.messages : [];
        setMessages(list);
        setCount(list.length);
        setError("");
        if (first) void call({ action: "read" }).catch(() => {});
      } catch (e) {
        // 定期更新の失敗は出さない（画面がうるさくなるだけなので初回だけ）
        if (first) setError(e instanceof Error ? e.message : "取得に失敗しました");
      }
    },
    [call]
  );

  // 開いている間だけ読む。マウント時に件数を取りに行くと、承認待ちが並ぶ画面で
  // カードの数だけリクエストが飛ぶため、開くまで通信しない。
  // 初回取得を setTimeout(0) に載せているのは、effect の本体から同期的に
  // setState が走る形を避けるため（React の cascading render 警告になる）。
  useEffect(() => {
    if (!open) return;
    const first = setTimeout(() => void load(true), 0);
    const poll = setInterval(() => {
      if (!document.hidden) void load(false);
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [open, load]);

  // 新着で下端に追従する。過去を読んでいる最中はスクロールを奪わない。
  useEffect(() => {
    const el = listRef.current;
    if (!el || !messages) return;
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await call({ action: "post", message: body, url: typeof window !== "undefined" ? window.location.href : "" });
      setText("");
      setError("");
      atBottomRef.current = true;
      await load(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-brand-700"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        連絡欄
        {count ? <span className="tabular-nums text-slate-500">{count}件</span> : null}
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50">
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="max-h-64 space-y-2.5 overflow-y-auto p-3"
          >
            {messages === null ? (
              <p className="py-4 text-center text-xs text-slate-400">読み込み中…</p>
            ) : messages.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">
                まだ発言はありません。承認の可否や差し戻しの理由をここで相談できます。
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
                  <div className="mb-0.5 text-[11px] text-slate-500">
                    {m.name}　{timeLabel(m.createdAt)}
                  </div>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-[13px] leading-relaxed ${
                      m.mine
                        ? "bg-brand-50 text-slate-800 ring-1 ring-brand-100"
                        : "bg-white text-slate-800 ring-1 ring-slate-200"
                    }`}
                  >
                    {renderBody(m.body)}
                  </div>
                </div>
              ))
            )}
          </div>

          {error ? (
            <p className="border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">{error}</p>
          ) : null}

          <div className="flex gap-2 border-t border-slate-200 bg-white p-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="メッセージを入力（Ctrl+Enterで送信）"
              className="flex-1 resize-y rounded-lg border border-slate-300 px-2.5 py-1.5 text-[13px] focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || !text.trim()}
              className="inline-flex items-center gap-1 self-end rounded-lg bg-brand-700 px-3 py-2 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {sending ? "送信中…" : "送信"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
