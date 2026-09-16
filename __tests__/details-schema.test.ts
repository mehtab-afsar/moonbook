import { buildDetailsSchema, pruneEmpty, type ActivityField } from "@/lib/activities/details-schema";

function field(over: Partial<ActivityField> & Pick<ActivityField, "key" | "field_type">): ActivityField {
  return {
    label: over.key,
    options: [],
    is_required: false,
    archived_at: null,
    ...over,
  } as ActivityField;
}

/** Two genuinely different industries, from one builder. */
const FREIGHT: ActivityField[] = [
  field({ key: "origin", field_type: "text", is_required: true, label: "Origin" }),
  field({ key: "destination", field_type: "text", is_required: true, label: "Destination" }),
  field({ key: "vehicle_no", field_type: "text", label: "Vehicle no." }),
];

const RECYCLING: ActivityField[] = [
  field({
    key: "material_grade",
    field_type: "select",
    options: ["PET", "HDPE", "LDPE", "Mixed"],
    is_required: true,
    label: "Material grade",
  }),
  field({ key: "weight_kg", field_type: "number", is_required: true, label: "Weight (kg)" }),
  field({ key: "contaminated", field_type: "boolean", label: "Contaminated" }),
  field({ key: "collected_on", field_type: "date", label: "Collected on" }),
];

describe("details schema", () => {
  describe("the same builder serves different industries", () => {
    it("accepts a valid freight record", () => {
      const r = buildDetailsSchema(FREIGHT).safeParse({
        origin: "Bengaluru",
        destination: "Chennai",
        vehicle_no: "KA-01-AB-1234",
      });
      expect(r.success).toBe(true);
    });

    it("accepts a valid recycling record", () => {
      const r = buildDetailsSchema(RECYCLING).safeParse({
        material_grade: "PET",
        weight_kg: 500,
        contaminated: false,
      });
      expect(r.success).toBe(true);
    });

    it("rejects a recycling record against the freight schema", () => {
      const r = buildDetailsSchema(FREIGHT).safeParse({ material_grade: "PET", weight_kg: 500 });
      expect(r.success).toBe(false);
    });
  });

  describe("required fields", () => {
    it("rejects a missing required field, naming it", () => {
      const r = buildDetailsSchema(RECYCLING).safeParse({ weight_kg: 500 });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("material_grade");
    });

    it("rejects an empty string for a required text field", () => {
      const r = buildDetailsSchema(FREIGHT).safeParse({ origin: "   ", destination: "Chennai" });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("Origin is required");
    });

    it("allows an optional field to be absent", () => {
      const r = buildDetailsSchema(FREIGHT).safeParse({ origin: "A", destination: "B" });
      expect(r.success).toBe(true);
    });
  });

  describe("types are enforced per field", () => {
    it("rejects a string where a number is declared", () => {
      const r = buildDetailsSchema(RECYCLING).safeParse({ material_grade: "PET", weight_kg: "500" });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("must be a number");
    });

    it("rejects a value outside a select's options", () => {
      const r = buildDetailsSchema(RECYCLING).safeParse({ material_grade: "PVC", weight_kg: 1 });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("must be one of");
    });

    it("rejects a malformed date", () => {
      const r = buildDetailsSchema(RECYCLING).safeParse({
        material_grade: "PET", weight_kg: 1, collected_on: "15/03/2026",
      });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("must be a date");
    });

    it("rejects a string where a boolean is declared", () => {
      const r = buildDetailsSchema(RECYCLING).safeParse({
        material_grade: "PET", weight_kg: 1, contaminated: "yes",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("unknown keys", () => {
    it("rejects rather than silently dropping them", () => {
      // A typo'd key that vanishes is worse than one that complains: the data
      // looks saved and isn't.
      const r = buildDetailsSchema(FREIGHT).safeParse({
        origin: "A", destination: "B", destinaton: "typo",
      });
      expect(r.success).toBe(false);
    });
  });

  describe("archived fields", () => {
    const withArchived: ActivityField[] = [
      field({ key: "origin", field_type: "text", is_required: true, label: "Origin" }),
      field({ key: "old_code", field_type: "text", is_required: true, label: "Old code", archived_at: "2026-01-01" }),
    ];

    it("does not require a field that has been archived", () => {
      expect(buildDetailsSchema(withArchived).safeParse({ origin: "A" }).success).toBe(true);
    });

    it("still accepts a historical value for it", () => {
      // A row captured before the field was retired must stay editable.
      expect(
        buildDetailsSchema(withArchived).safeParse({ origin: "A", old_code: "X-1" }).success,
      ).toBe(true);
    });
  });

  describe("pruneEmpty", () => {
    it("removes blanks and nulls, and trims what it keeps", () => {
      expect(pruneEmpty({ a: "  kept  ", b: "", c: null, d: undefined, e: 0, f: false })).toEqual({
        a: "kept",
        e: 0,
        f: false,
      });
    });

    it("keeps zero and false, which are values rather than blanks", () => {
      expect(pruneEmpty({ weight: 0, contaminated: false })).toEqual({ weight: 0, contaminated: false });
    });
  });
});
