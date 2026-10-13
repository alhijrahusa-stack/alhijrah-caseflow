import { describe, expect, it } from "vitest";
import { readLocalFields } from "@/components/staff/smart/intelligence";
import { extractDeterministicClient } from "@/lib/smart-client-local";
import {
  isOvernightShift,
  normalizeArabicTime,
  normalizeShiftDays,
  normalizeShiftTime,
  parseShiftRange,
} from "@/lib/smart-client-fields";

/**
 * Arabic source understanding, and the overnight indicator.
 *
 * Arabic states the same facts without colon-delimited labels: the hour is a word,
 * the minutes are a fraction of it, and the half of the day is said separately. Each
 * case asserts the exact canonical value, or asserts that nothing is written when the
 * source is genuinely ambiguous.
 */

function read(source: string) {
  const local = extractDeterministicClient(source);
  const byKey = Object.fromEntries(readLocalFields(local.row, local.evidence).map((item) => [item.field.key, item]));
  return { row: local.row, byKey };
}

describe("Arabic day normalization", () => {
  it.each([
    ["الجمعة", ["FRI"]],
    ["الاثنين", ["MON"]],
    ["الإثنين", ["MON"]],
    ["من الجمعة إلى الاثنين", ["FRI", "SAT", "SUN", "MON"]],
    ["الخميس حتى الاثنين", ["THU", "FRI", "SAT", "SUN", "MON"]],
    ["الجمعة والسبت", ["FRI", "SAT"]],
    ["الجمعة، السبت، الأحد", ["FRI", "SAT", "SUN"]],
    ["أيام العمل", ["MON", "TUE", "WED", "THU", "FRI"]],
    ["نهاية الأسبوع", ["SAT", "SUN"]],
    ["يومياً", ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]],
  ])("reads %s", (source, expected) => {
    expect(normalizeShiftDays(source)).toEqual(expected);
  });

  it("leaves the English behaviour unchanged", () => {
    expect(normalizeShiftDays("Thu-Mon")).toEqual(["THU", "FRI", "SAT", "SUN", "MON"]);
    expect(normalizeShiftDays("weekends")).toEqual(["SAT", "SUN"]);
    expect(normalizeShiftDays("not a day")).toBeNull();
  });
});

describe("Arabic clock readings", () => {
  it.each([
    ["السادسة مساءً", "18:00"],
    ["السادسة مساء", "18:00"],
    ["الرابعة والنصف صباحًا", "04:30"],
    ["الرابعة و النصف صباحا", "04:30"],
    ["السابعة والربع صباحا", "07:15"],
    ["الثامنة إلا ربع مساء", "19:45"],
    ["العاشرة ليلا", "22:00"],
    ["الثانية عشرة والنصف صباحا", "00:30"],
    ["الحادية عشرة مساء", "23:00"],
    ["٦ مساء", "18:00"],
    ["6 صباحا", "06:00"],
  ])("reads %s as %s", (source, expected) => {
    expect(normalizeArabicTime(source)).toBe(expected);
    expect(normalizeShiftTime(source)).toBe(expected);
  });

  it("writes nothing when the half of the day is not stated", () => {
    // 05:00 and 17:00 are not the same shift, so an unstated meridiem is not guessed.
    expect(normalizeArabicTime("الخامسة")).toBeNull();
    expect(normalizeShiftTime("الخامسة")).toBeNull();
  });

  it("writes nothing for Arabic text that states no hour", () => {
    expect(normalizeArabicTime("عنده سيارة")).toBeNull();
    expect(normalizeArabicTime("")).toBeNull();
  });

  it("leaves the English clock path unchanged", () => {
    expect(normalizeShiftTime("6pm")).toBe("18:00");
    expect(normalizeShiftTime("4:30am")).toBe("04:30");
    expect(normalizeShiftTime("18:00")).toBe("18:00");
    expect(normalizeShiftTime("99pm")).toBeNull();
  });

  it("reads an Arabic range, overnight included", () => {
    expect(parseShiftRange("من السادسة مساءً إلى الرابعة والنصف صباحًا"))
      .toEqual({ start: "18:00", end: "04:30", overnight: true });
  });
});

describe("Overnight indicator", () => {
  it("is derived from the two canonical times, never stored separately", () => {
    expect(isOvernightShift("18:00", "04:30")).toBe(true);
    expect(isOvernightShift("6pm", "4:30am")).toBe(true);
    expect(isOvernightShift("09:00", "17:00")).toBe(false);
    expect(isOvernightShift("22:00", "22:00")).toBe(true);
  });

  it("reports nothing when either end is unknown", () => {
    expect(isOvernightShift("18:00", null)).toBeNull();
    expect(isOvernightShift(null, "04:30")).toBeNull();
    expect(isOvernightShift("18:00", "not a time")).toBeNull();
  });
});

describe("Arabic free text in the source box", () => {
  it("reads a name introduced without a label", () => {
    expect(read("اسمه أحمد محمد").row.full_name).toBe("أحمد محمد");
    expect(read("الاسم أحمد محمد علي").row.full_name).toBe("أحمد محمد علي");
  });

  it("reads a work place named by a preposition, only in a work context", () => {
    expect(read("يريد الشفت الليلي في رومولس").row.site_code).toBe("رومولس");
    // No work context: a preposition alone is not a work preference.
    expect(read("سافر في رومولس").row.site_code).toBeUndefined();
  });

  it("never reads a day or a shift word as an Arabic place name", () => {
    const { row } = read("يريد العمل في الشفت الليلي");
    expect(row.site_code).toBeUndefined();
    expect(row.shift_code).toBe("NIGHT");
  });

  it.each([
    ["الشفت الليلي", "NIGHT"],
    ["شفت صباحي", "MORNING"],
    ["الوردية المسائية", "EVENING"],
    ["شفت نهاري", "DAY"],
  ])("reads the Arabic shift type in %s", (source, expected) => {
    expect(read(source).row.shift_code).toBe(expected);
  });

  it("reads the rest of a line that also carries a phone number", () => {
    // One dictated sentence with a phone in the middle of it. Matching one shape
    // must not cost the line everything else it says.
    const { row } = read("اسمه أحمد محمد، رقمه 313-555-0151، يريد الشفت الليلي في رومولس، من الجمعة إلى الاثنين");
    expect(row.phone).toBe("3135550151");
    expect(row.full_name).toBe("أحمد محمد");
    expect(row.site_code).toBe("رومولس");
    expect(row.shift_code).toBe("NIGHT");
    expect(row.shift_days).toBe("FRI, SAT, SUN, MON");
  });

  it("reads the rest of an English line that also carries an email", () => {
    const { row } = read("Reach jane@example.com — night shift, Friday-Monday, 6:00 PM to 4:30 AM");
    expect(row.email).toBe("jane@example.com");
    expect(row.shift_code).toBe("NIGHT");
    expect(row.shift_days).toBe("FRI, SAT, SUN, MON");
    expect(row.shift_start_time).toBe("18:00");
    expect(row.shift_end_time).toBe("04:30");
  });

  it("still refuses to read a place out of an address line", () => {
    const { row } = read("7401 Winthrop St, Detroit, MI 48228");
    expect(row.street).toBe("7401 Winthrop St");
    expect(row.city).toBe("Detroit");
    expect(row.site_code).toBeUndefined();
    expect(row.work_location_candidates).toBeUndefined();
  });

  it("classifies the whole dictated Arabic sentence from the directive", () => {
    const { row } = read(
      "اسمه أحمد محمد، يريد الشفت الليلي في رومولس، من الجمعة إلى الاثنين، من السادسة مساءً إلى الرابعة والنصف صباحًا، وعنده سيارة.",
    );
    expect(row.full_name).toBe("أحمد محمد");
    expect(row.site_code).toBe("رومولس");
    expect(row.shift_code).toBe("NIGHT");
    expect(row.shift_days).toBe("FRI, SAT, SUN, MON");
    expect(row.shift_start_time).toBe("18:00");
    expect(row.shift_end_time).toBe("04:30");
    expect(isOvernightShift(String(row.shift_start_time), String(row.shift_end_time))).toBe(true);
    // The sentence is one line, so it is preserved whole rather than cut mid-sentence;
    // the detail with no field of its own survives either way.
    expect(String(row.additional_notes)).toContain("سيارة");
  });

  it("surfaces the dictated Arabic facts on the Live Intelligence contract", () => {
    const { byKey } = read(
      "اسمه أحمد محمد، يريد الشفت الليلي في رومولس، من الجمعة إلى الاثنين، من السادسة مساءً إلى الرابعة والنصف صباحًا، وعنده سيارة.",
    );
    expect(byKey.full_name.normalized).toBe("أحمد محمد");
    expect(byKey.first_name.normalized).toBe("أحمد");
    expect(byKey.last_name.normalized).toBe("محمد");
    expect(byKey.preferred_location.normalized).toBe("رومولس");
    expect(byKey.preferred_shift.normalized).toBe("NIGHT");
    expect(byKey.shift_days.normalized).toEqual(["FRI", "SAT", "SUN", "MON"]);
    expect(byKey.shift_start_time.normalized).toBe("18:00");
    expect(byKey.shift_end_time.normalized).toBe("04:30");
    // Nothing the sentence never stated is reported.
    expect(byKey.email.normalized).toBeNull();
    expect(byKey.date_of_birth.normalized).toBeNull();
    expect(byKey.zip.normalized).toBeNull();
  });
});

describe("Name parts", () => {
  it("splits a two-part and a multi-part name", () => {
    expect(read("Full Name: Ahmed Mohammed").row).toMatchObject({ first_name: "Ahmed", last_name: "Mohammed" });
    expect(read("Full Name: Ahmed Ali Hassan Mohammed").row).toMatchObject({
      first_name: "Ahmed", middle_name: "Ali Hassan", last_name: "Mohammed",
    });
  });

  it("writes no middle name when the name has only two parts", () => {
    expect(read("Full Name: Ahmed Mohammed").row.middle_name).toBeUndefined();
  });

  it("writes nothing when there is no full name to read", () => {
    const { row } = read("Phone: 313-555-0198");
    expect(row.first_name).toBeUndefined();
    expect(row.last_name).toBeUndefined();
  });

  it("keeps a labelled part over the split of the full name", () => {
    const { row } = read("Full Name: Ahmed Ali Mohammed\nLast Name: Al Baadani");
    expect(row.last_name).toBe("Al Baadani");
    expect(row.first_name).toBe("Ahmed");
  });
});
