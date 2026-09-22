const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** 0–999 → words, the building block every larger group reuses. */
function threeDigits(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10].toLowerCase()}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(" ");
}

/**
 * The whole-number part of an amount, spelled out — international scale
 * (thousand/million/billion), not the Indian lakh/crore grouping, because
 * this runs for every currency this app supports, not just INR. Handles
 * 0 to 999,999,999,999.
 */
export function numberToWords(n: number): string {
  if (n === 0) return "Zero";
  if (!Number.isFinite(n) || n < 0) return String(n);

  const groups = ["", " Thousand", " Million", " Billion"];
  let value = Math.floor(n);
  const parts: string[] = [];
  let groupIndex = 0;

  while (value > 0) {
    const chunk = value % 1000;
    if (chunk > 0) {
      parts.unshift(threeDigits(chunk) + groups[groupIndex]);
    }
    value = Math.floor(value / 1000);
    groupIndex += 1;
  }

  return parts.join(" ");
}

/** "Amount chargeable (in words)" — the major-unit integer, spelled out, currency named rather than symboled for the same reason every other PDF figure is. */
export function amountInWords(majorUnits: number, currencyCode: string): string {
  return `${currencyCode} ${numberToWords(Math.floor(majorUnits))} Only`;
}
