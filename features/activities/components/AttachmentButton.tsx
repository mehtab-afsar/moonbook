"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Loader2 } from "lucide-react";

/** Upload or open the one proof-of-delivery file an activity can carry. */
export function AttachmentButton({ activityId, hasAttachment }: { activityId: string; hasAttachment: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/activities/${activityId}/attachment`, { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not upload that file.");
      return;
    }
    router.refresh();
  }

  async function open() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/activities/${activityId}/attachment`);
    setBusy(false);
    if (!res.ok) {
      setError("Could not open that file.");
      return;
    }
    const { data } = await res.json();
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {hasAttachment ? (
        <button
          type="button" onClick={open} disabled={busy}
          className="inline-flex items-center gap-1 text-[12.5px] text-brand hover:underline"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" strokeWidth={1.75} />}
          View proof
        </button>
      ) : (
        <>
          <button
            type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink-2"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" strokeWidth={1.75} />}
            Attach
          </button>
          <input
            ref={inputRef} type="file" className="hidden"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </>
      )}
      {error && <span className="text-[11.5px] text-overdue">{error}</span>}
    </span>
  );
}
