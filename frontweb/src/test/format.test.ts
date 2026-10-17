import { describe, expect, it } from "vitest";
import { shortName } from "@/lib/format";

describe("shortName", () => {
  it("keeps the first name and the initial of the last name", () => {
    expect(shortName("Awa Diallo")).toBe("Awa D.");
    expect(shortName("Mamadou Lamine Sow")).toBe("Mamadou S.");
  });
  it("handles a single word and empty input", () => {
    expect(shortName("Awa")).toBe("Awa");
    expect(shortName("  ")).toBe("");
  });
});
