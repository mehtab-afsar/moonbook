export type Period = { from: string; to: string; label: string; preset: string };

const PRESETS = ["7", "15", "30", "90"] as const;

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolves a dashboard's reporting window from its `searchParams`. A
 * `period` of 7/15/30/90 counts back that many days from today, as seen in
 * the organisation's own timezone; `from`/`to` override it with an explicit
 * custom range. Invalid input falls back to the 30-day default rather than
 * erroring — this only ever drives a report view.
 */
export function resolvePeriod(
  searchParams: { period?: string; from?: string; to?: string },
  timezone: string,
): Period {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  if (searchParams.from && searchParams.to) {
    return {
      from: searchParams.from, to: searchParams.to,
      label: `${searchParams.from} to ${searchParams.to}`, preset: "custom",
    };
  }

  const preset = PRESETS.includes(searchParams.period as (typeof PRESETS)[number]) ? searchParams.period! : "30";
  return {
    from: subtractDays(today, Number(preset)),
    to: today,
    label: `Last ${preset} days`,
    preset,
  };
}
