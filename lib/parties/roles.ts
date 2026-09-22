/**
 * Vendor vs. client is never stored — it's read off which direction a
 * party's documents have gone. A party billed payable is a vendor (we pay
 * them), receivable is a client (they pay us); both directions makes them
 * both; no documents yet makes them "other". Presentational only, computed
 * fresh from each request — see the Parties list page for the schema
 * decision this mirrors.
 */
export type PartyRole = "vendor" | "client" | "both" | "other";

/**
 * Splits a party list into "Clients"/"Vendors"/"Other parties" groups for a
 * dropdown's optgroups. A party billed both ways appears in both the
 * clients and vendors groups — there is only one real party either way, the
 * duplicate `<option>` just makes it findable under whichever heading the
 * user is scanning.
 */
export function groupPartiesByRole<T extends { id: string; role?: PartyRole }>(
  parties: T[],
): { clients: T[]; vendors: T[]; other: T[] } {
  const clients: T[] = [];
  const vendors: T[] = [];
  const other: T[] = [];
  for (const p of parties) {
    const role = p.role ?? "other";
    if (role === "client" || role === "both") clients.push(p);
    if (role === "vendor" || role === "both") vendors.push(p);
    if (role === "other") other.push(p);
  }
  return { clients, vendors, other };
}

/**
 * A strict single-type list — for pickers where showing both would be the
 * bug, not a feature (billing a client, paying a vendor). `kind` (set when
 * the party was added, via the Parties tabs) is the source of truth when
 * present; a party added before `kind` existed falls back to its computed
 * `role` from document history. Either way, a party explicitly tagged the
 * OPPOSITE kind is excluded outright — that's the actual complaint this
 * exists to fix, not a stricter version of the grouping above.
 */
export function filterPartiesForKind<
  T extends { id: string; role?: PartyRole; kind?: "client" | "vendor" | null },
>(parties: T[], want: "client" | "vendor"): T[] {
  const opposite = want === "client" ? "vendor" : "client";
  return parties.filter((p) => {
    if (p.kind) return p.kind === want;
    const role = p.role ?? "other";
    if (role === "both" || role === "other") return true;
    return role !== opposite;
  });
}

export function computePartyRoles(
  directions: { counterparty_id: string; direction: string }[],
): Map<string, PartyRole> {
  const roleByParty = new Map<string, PartyRole>();
  for (const d of directions) {
    const id = d.counterparty_id;
    const thisRole: PartyRole = d.direction === "payable" ? "vendor" : "client";
    const prev = roleByParty.get(id);
    if (!prev) roleByParty.set(id, thisRole);
    else if (prev !== thisRole) roleByParty.set(id, "both");
  }
  return roleByParty;
}
