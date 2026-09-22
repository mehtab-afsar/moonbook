import { formatIrnForPrint } from "@/lib/pdf/templates/types";

describe("formatIrnForPrint", () => {
  it("groups a 64-char IRN into 4-character chunks", () => {
    const irn = "a".repeat(64);
    const formatted = formatIrnForPrint(irn);
    expect(formatted).toBe(Array(16).fill("aaaa").join(" "));
    expect(formatted).toContain(" "); // react-pdf/Yoga needs a break point to wrap on
  });

  it("round-trips back to the original with spaces stripped — nothing is lost", () => {
    const irn = "0123456789abcdef".repeat(4); // 64 chars, real-looking hex
    expect(formatIrnForPrint(irn).replace(/ /g, "")).toBe(irn);
  });

  it("handles a non-multiple-of-4 length without dropping characters", () => {
    expect(formatIrnForPrint("abc12").replace(/ /g, "")).toBe("abc12");
  });
});
