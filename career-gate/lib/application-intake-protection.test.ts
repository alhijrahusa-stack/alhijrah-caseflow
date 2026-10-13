import { describe, expect, it } from "vitest";
import { ProfileSchema } from "@/lib/schemas";
import { SMART_FIELDS } from "@/components/staff/smart/field-contract";
import { prepareImportDraft } from "@/lib/smart-client-import-core";

/**
 * Application Intake protection.
 *
 * `/apply` and `/api/intake` are an independent, protected path. They reach two of
 * the modules the Smart work changes — `lib/smart-client-import-core.ts` through
 * `lib/service.ts`, and `lib/smart-client-fields.ts` through that — so this suite
 * locks the one contract they share with the browser: `ProfileSchema`, which is the
 * request body `/api/intake` validates.
 *
 * If a later Smart change needs a new canonical field, it belongs in the Smart review
 * scope, and these assertions are what will say so.
 */

/** Every key the Application Intake request body may carry, and no others. */
const APPLICATION_INTAKE_PROFILE_KEYS = [
  "full_name",
  "phone",
  "email",
  "date_of_birth",
  "preferred_language",
  "english_proficiency",
  "street",
  "city",
  "state",
  "zip",
  "appointment_availability",
  "amazon_worked_before",
  "amazon_worked_from",
  "amazon_worked_to",
  "amazon_applied_before",
  "currently_amazon",
  "via_agency",
  "amazon_application_email",
  "employment_history",
] as const;

/**
 * The keys the schema actually produces, read by parsing rather than by reaching
 * into zod's internals — behaviour is the contract, not the library's shape API.
 */
function profileKeys() {
  const parsed = ProfileSchema.safeParse({
    full_name: "A Client",
    phone: "3135550100",
    email: "a@example.com",
    date_of_birth: "1990-01-15",
    preferred_language: "en",
    english_proficiency: "GOOD",
    street: "1 Main St",
    city: "Detroit",
    state: "MI",
    zip: "48226",
    appointment_availability: "weekdays",
    amazon_worked_before: true,
    amazon_worked_from: "2020-01-01",
    amazon_worked_to: "2021-01-01",
    amazon_applied_before: true,
    currently_amazon: false,
    via_agency: false,
    amazon_application_email: "a@example.com",
    employment_history: [],
    // Keys the schema must not carry through, Smart-only and otherwise.
    first_name: "A",
    last_name: "Client",
    work_location_candidates: "Detroit",
    additional_notes: "note",
    preferred_shift: "NIGHT",
    ssn: "000-00-0000",
  });
  if (!parsed.success) throw new Error(`the full valid payload was rejected: ${parsed.error.issues[0]?.message}`);
  return Object.keys(parsed.data).sort();
}

describe("the Application Intake request contract is unchanged", () => {
  it("accepts exactly the keys it always accepted", () => {
    expect(profileKeys()).toEqual([...APPLICATION_INTAKE_PROFILE_KEYS].sort());
  });

  it("still rejects a payload missing the two fields it requires", () => {
    expect(ProfileSchema.safeParse({}).success).toBe(false);
    expect(ProfileSchema.safeParse({ full_name: "A Client", phone: "" }).success).toBe(false);
  });

  it("still accepts the minimum valid payload and normalizes it the same way", () => {
    const parsed = ProfileSchema.safeParse({ full_name: "A Client", phone: "(313) 555-0100" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.email).toBeNull();
    expect(parsed.success && parsed.data.employment_history).toEqual([]);
  });

  it("still applies its own validation rules, untouched by the Smart path", () => {
    expect(ProfileSchema.safeParse({ full_name: "A Client", phone: "3135550100", zip: "48" }).success).toBe(false);
    expect(ProfileSchema.safeParse({ full_name: "A Client", phone: "3135550100", date_of_birth: "2990-01-01" }).success).toBe(false);
    expect(ProfileSchema.safeParse({ full_name: "A Client", phone: "3135550100", preferred_language: "zz" }).success).toBe(false);
  });

  it("drops a Smart-only field rather than carrying it into the canonical profile", () => {
    // The name's parts and the candidate list are Smart review fields. Even if one
    // reached this schema, it must not become part of the Application Intake profile.
    const parsed = ProfileSchema.safeParse({
      full_name: "A Client",
      phone: "3135550100",
      first_name: "A",
      last_name: "Client",
      work_location_candidates: "Detroit, Romulus",
      additional_notes: "note",
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    for (const key of ["first_name", "middle_name", "last_name", "work_location_candidates", "additional_notes", "preferred_shift"]) {
      expect(Object.prototype.hasOwnProperty.call(parsed.data, key)).toBe(false);
    }
  });
});

describe("Smart-only fields stay in the Smart scope", () => {
  it("keeps every field the Smart work added out of the profile scope", () => {
    for (const key of ["first_name", "middle_name", "last_name", "work_location_candidates", "preferred_shift", "additional_notes"]) {
      const field = SMART_FIELDS.find((item) => item.key === key);
      expect(field, `${key} is missing from the reviewed contract`).toBeDefined();
      expect(field!.scope, `${key} must not be written to the canonical profile`).toBe("review_fields");
    }
  });

  it("stages Smart-only fields into review_fields and never into the profile", () => {
    const draft = prepareImportDraft({
      full_name: "A Client",
      phone: "3135550100",
      first_name: "A",
      last_name: "Client",
      work_location_candidates: "Detroit, Romulus",
      shift_code: "NIGHT",
      additional_notes: "Has a car.",
    });
    expect(draft.review_fields.first_name).toBe("A");
    expect(draft.review_fields.last_name).toBe("Client");
    expect(draft.review_fields.work_location_candidates).toBe("Detroit, Romulus");
    expect(draft.review_fields.preferred_shift).toBe("NIGHT");
    expect(draft.review_fields.additional_notes).toBe("Has a car.");
    for (const key of ["first_name", "middle_name", "last_name", "work_location_candidates", "preferred_shift", "additional_notes"]) {
      expect(Object.prototype.hasOwnProperty.call(draft.profile, key)).toBe(false);
    }
  });
});
