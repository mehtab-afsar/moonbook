"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, buttonPrimaryClass } from "@/lib/ui/styles";

export interface InviteRow {
  id: string;
  email: string;
  role: "owner" | "staff";
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

/**
 * Invite a teammate by email — no email is sent; share the address out of
 * band and they accept it just by signing up with that exact address (see
 * accept_org_invite()). Owner-only: everyone in the org can see who's
 * pending, but only an owner can add or withdraw one.
 */
export function TeamInvites({ invites, isOwner, today }: { invites: InviteRow[]; isOwner: boolean; today: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "staff">("staff");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const pending = invites.filter((i) => !i.accepted_at && i.expires_at > today);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch("/api/settings/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Could not send this invite.");
      return;
    }
    setEmail("");
    setRole("staff");
    router.refresh();
  }

  async function cancel(id: string) {
    setCancellingId(id);
    const res = await fetch(`/api/settings/invites/${id}`, { method: "DELETE" });
    setCancellingId(null);
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      {isOwner ? (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="invite-email" className="mb-1.5 block text-[13px] font-medium text-ink">
              Invite by email
            </label>
            <input
              id="invite-email" type="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} className={inputClass}
              placeholder="teammate@example.com"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="mb-1.5 block text-[13px] font-medium text-ink">Role</label>
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as "owner" | "staff")} className={inputClass}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className={buttonPrimaryClass}>
            {saving ? "Sending…" : "Send invite"}
          </button>
        </form>
      ) : (
        <p className="text-[13px] text-ink-3">Only an owner can invite someone new.</p>
      )}

      {error && <p className="text-[12.5px] text-overdue">{error}</p>}
      {isOwner && (
        <p className="text-[12.5px] text-ink-3">
          No email is sent — tell them to sign up with this exact address, and they&apos;ll land in this
          organisation instead of starting their own.
        </p>
      )}

      {pending.length > 0 && (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line-soft text-[12px] uppercase tracking-wide text-ink-3">
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Expires</th>
                {isOwner && <th className="px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {pending.map((i) => (
                <tr key={i.id} className="border-b border-line-soft last:border-b-0">
                  <td className="px-5 py-3 font-mono text-ink">{i.email}</td>
                  <td className="px-5 py-3 text-ink-2 capitalize">{i.role}</td>
                  <td className="px-5 py-3 font-mono text-ink-2">{i.expires_at.slice(0, 10)}</td>
                  {isOwner && (
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button" onClick={() => cancel(i.id)} disabled={cancellingId === i.id}
                        className="text-[13px] text-ink-2 hover:text-overdue"
                      >
                        Withdraw
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
