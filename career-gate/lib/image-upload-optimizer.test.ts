import { describe, expect, it } from "vitest";
import { formatBytes, MAX_EDGE, planImage, renamedFor, SMALL_ENOUGH_BYTES } from "@/lib/image-upload-optimizer";

describe("upload image plan", () => {
  it("fits large photos within the long-edge limit, keeping the aspect ratio", () => {
    expect(planImage({ type: "image/jpeg", size: 6_000_000, width: 4032, height: 3024 })).toEqual({ resize: true, width: MAX_EDGE, height: 1440, reencode: true });
    expect(planImage({ type: "image/png", size: 5_000_000, width: 3024, height: 4032 })).toEqual({ resize: true, width: 1440, height: MAX_EDGE, reencode: true });
  });

  it("re-encodes a heavy photo that is already small enough, and leaves a light one alone", () => {
    expect(planImage({ type: "image/png", size: SMALL_ENOUGH_BYTES + 1, width: 1200, height: 800 })).toMatchObject({ resize: false, reencode: true });
    expect(planImage({ type: "image/jpeg", size: SMALL_ENOUGH_BYTES, width: 1200, height: 800 })).toMatchObject({ resize: false, reencode: false });
  });

  it("never touches PDFs or unknown types", () => {
    expect(planImage({ type: "application/pdf", size: 3_000_000, width: 5000, height: 5000 })).toMatchObject({ resize: false, reencode: false });
    expect(planImage({ type: "image/heic", size: 3_000_000, width: 5000, height: 5000 })).toMatchObject({ reencode: false });
  });

  it("names the optimized file after the encoder actually used", () => {
    expect(renamedFor("IMG_0042.JPG", "image/webp")).toBe("IMG_0042.webp");
    expect(renamedFor("scan.final.png", "image/jpeg")).toBe("scan.final.jpg");
    expect(renamedFor("photo", "image/webp")).toBe("photo.webp");
    expect(renamedFor("", "image/webp")).toBe("document.webp");
  });

  it("formats sizes for the confirmation line", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(410 * 1024)).toBe("410 KB");
    expect(formatBytes(6.2 * 1024 * 1024)).toBe("6.2 MB");
  });
});
