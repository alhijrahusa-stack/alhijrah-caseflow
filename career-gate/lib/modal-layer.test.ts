import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireModalLayer, isTopModalLayer, releaseModalLayer } from "@/lib/modal-layer";

afterEach(() => vi.unstubAllGlobals());
describe("nested staff modal ownership", () => {
  it("gives commands Escape ownership and retains the parent scroll lock", () => {
    vi.stubGlobal("document", { body: { style: { overflow: "auto" } } });
    const review=Symbol("review"),commands=Symbol("commands");
    acquireModalLayer(review);acquireModalLayer(commands);
    expect(isTopModalLayer(review)).toBe(false);
    expect(isTopModalLayer(commands)).toBe(true);
    releaseModalLayer(commands);
    expect(isTopModalLayer(review)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    releaseModalLayer(review);
    expect(document.body.style.overflow).toBe("auto");
  });
  it("keeps the foreground locked if its parent unmounts first", () => {
    vi.stubGlobal("document", { body: { style: { overflow: "" } } });
    const parent=Symbol("parent"),child=Symbol("child");
    acquireModalLayer(parent);acquireModalLayer(child);releaseModalLayer(parent);
    expect(isTopModalLayer(child)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    releaseModalLayer(child);releaseModalLayer(child);
    expect(document.body.style.overflow).toBe("");
  });
});
