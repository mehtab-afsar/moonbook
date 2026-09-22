/** A small "Step 1 of 3" marker shared across the onboarding screens. */
export function StepBadge({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-6 flex items-center gap-2">
      <div className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1 w-6 rounded-full ${i < current ? "bg-ink" : "bg-line"}`}
          />
        ))}
      </div>
      <span className="text-[12px] font-medium text-ink-3">
        Step {current} of {total}
      </span>
    </div>
  );
}
