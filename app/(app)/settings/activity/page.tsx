import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAuth } from "@/lib/auth/verify";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity log" };

const LIMIT = 200;

/**
 * Not every action a person can take here is a "record a service" moment —
 * money-moving and state-changing ones are, and this reads exactly those:
 * whoever issues an invoice, records a payment, cancels a document, changes
 * the logo, or invites/joins the team leaves a row here, written by the same
 * SECURITY DEFINER RPC that made the change, not by the client. Recording a
 * plain activity in the log (a trip, a purchase) is deliberately not one of
 * these — see each RPC's own audit_events insert for exactly what is.
 */
const ACTION_LABEL: Record<string, string> = {
  "document.issued": "Issued a document",
  "document.cancelled": "Cancelled a document",
  "document.credited": "Raised a credit note",
  "payment.recorded": "Recorded a payment",
  "allocation.created": "Applied a payment",
  "activity.updated": "Corrected an activity",
  "activity.attachment_set": "Attached a file",
  "logistics_activity.recorded": "Recorded a service",
  "logistics_activity.attachment_set": "Attached a file",
  "logistics_document.issued": "Issued a document",
  "logistics_payment.recorded": "Recorded a payment",
  "plastics_activity.recorded": "Recorded a purchase or sale",
  "plastics_document.issued": "Issued a document",
  "plastics_payment.recorded": "Recorded a payment",
  "organisation.created": "Created this business",
  "organisation.logo_set": "Changed the logo",
  "organisation.vertical_activated": "Activated a ledger",
  "industry_template.applied": "Applied an industry template",
  "org_invite.accepted": "Joined the team",
  "org_invite.cancelled": "Withdrew a team invite",
};

/** "document.issued" → "Document issued", for anything not in the map above. */
function fallbackLabel(action: string): string {
  const [entity, verb] = action.split(".");
  if (!entity || !verb) return action;
  return `${entity.replace(/_/g, " ")} ${verb.replace(/_/g, " ")}`;
}

export default async function ActivityLogPage() {
  const auth = await verifyAuth();
  if (!auth.ok) redirect("/");

  const supabase = await createClient();
  const { data: events, error } = await supabase
    .from("audit_events")
    // FK named: audit_events reaches profiles by actor_id, and an ambiguous
    // embed is a PostgREST error rather than a guess.
    .select("id, action, entity_type, entity_id, before, after, reason, created_at, profiles!audit_events_actor_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) throw new Error(`Could not load the activity log: ${error.message}`);

  const rows = (events ?? []) as unknown as {
    id: string; action: string; entity_type: string; entity_id: string | null;
    before: unknown; after: unknown; reason: string | null; created_at: string;
    profiles: { full_name: string | null } | null;
  }[];

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 p-8">
      <header>
        <Link href="/settings" className="text-[13px] text-ink-2 hover:text-ink">← Settings</Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.01em] text-ink">Activity log</h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-ink-2">
          Who did what, and when — every teammate&apos;s money-moving and state-changing actions,
          written automatically the moment they happen. Showing the last {LIMIT}.
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-[10px] border border-line bg-white p-8 text-center text-[13.5px] text-ink-3">
          Nothing recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft rounded-[10px] border border-line bg-white">
          {rows.map((r) => (
            <li key={r.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-[13.5px] text-ink">
                  <span className="font-medium">{r.profiles?.full_name ?? "Someone"}</span>{" "}
                  {(ACTION_LABEL[r.action] ?? fallbackLabel(r.action)).toLowerCase()}
                  {r.entity_type && <span className="text-ink-3"> · {r.entity_type}</span>}
                </p>
                <time className="shrink-0 font-mono text-[12px] text-ink-3" dateTime={r.created_at}>
                  {formatTimestamp(r.created_at)}
                </time>
              </div>
              {r.reason && <p className="mt-1 text-[12.5px] text-ink-2">{r.reason}</p>}
              {(hasContent(r.before) || hasContent(r.after)) && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[12px] text-ink-3 hover:text-ink-2">Details</summary>
                  <div className="mt-2 grid gap-3 min-[640px]:grid-cols-2">
                    {hasContent(r.before) && <JsonBlock label="Before" value={r.before} />}
                    {hasContent(r.after) && <JsonBlock label="After" value={r.after} />}
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hasContent(v: unknown): boolean {
  return v !== null && v !== undefined;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md border border-line bg-paper p-3">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11.5px] text-ink-2">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
