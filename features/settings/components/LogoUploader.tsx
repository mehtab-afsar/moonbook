"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { buttonSecondaryClass } from "@/lib/ui/styles";

/**
 * The one piece of per-organisation branding Moonbook actually has: a logo,
 * printed on every invoice/bill/receipt PDF's letterhead. Every business
 * here is already its own isolated organisation — this is the only new
 * thing "configuring this for multiple companies" needed.
 */
export function LogoUploader({ hasLogo, isOwner }: { hasLogo: boolean; isOwner: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(hasLogo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hasLogo) return;
    let cancelled = false;
    fetch("/api/settings/logo")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!cancelled && body) setPreviewUrl(body.data.url); })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [hasLogo]);

  async function upload(file: File) {
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/settings/logo", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not upload that file.");
      return;
    }
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/settings/logo", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Could not remove the logo.");
      return;
    }
    setPreviewUrl(null);
    router.refresh();
  }

  if (!isOwner) {
    return (
      <p className="text-[13px] text-ink-3">
        {hasLogo ? "A logo is set for this business." : "No logo set."} Only an owner can change it.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-paper">
        {loadingPreview ? (
          <Loader2 className="size-4 animate-spin text-ink-3" />
        ) : previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL; next/image's remote-pattern allowlist would need updating per environment for no benefit here.
          <img src={previewUrl} alt="Company logo" className="size-full object-contain" />
        ) : (
          <span className="text-[11px] text-ink-3">No logo</span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button" onClick={() => inputRef.current?.click()} disabled={busy}
            className={buttonSecondaryClass}
          >
            {busy ? "Working…" : previewUrl ? "Replace logo" : "Upload logo"}
          </button>
          {previewUrl && (
            <button type="button" onClick={remove} disabled={busy} className="text-[13px] text-ink-2 hover:text-ink">
              Remove
            </button>
          )}
        </div>
        <p className="text-[12px] text-ink-3">PNG, JPEG or WEBP, up to 2 MB. Printed top-left on every PDF.</p>
        {error && <p className="text-[12px] text-overdue">{error}</p>}
      </div>

      <input
        ref={inputRef} type="file" className="hidden"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
