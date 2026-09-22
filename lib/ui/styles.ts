/** Shared class-name constants, so the same input never drifts between forms. */
export const inputClass =
  "w-full rounded-md border border-line bg-white px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-3 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-brand";

export const cardClass = "rounded-[10px] border border-line bg-white p-5";

/** An input with room on the left for a search icon — pair with a
 *  `lucide-react` Search icon absolutely positioned at `left-3`. */
export const searchInputClass =
  "w-full rounded-md border border-line bg-white py-2.5 pl-9 pr-3 text-[14px] text-ink placeholder:text-ink-3 focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-brand";

export const buttonPrimaryClass =
  "rounded-md bg-ink px-5 py-3 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:bg-ink-3";

export const buttonSecondaryClass =
  "rounded-md border border-line bg-white px-5 py-3 text-[14px] font-medium text-ink transition-colors duration-150 hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
