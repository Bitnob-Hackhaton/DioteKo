import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

describe("audit CSV export", () => {
  it("quotes separators and neutralises formulas", () => {
    expect(toCsv(["a", "b"], [["x;y", "=SUM(A1)"]])).toBe('a;b\r\n"x;y";\'=SUM(A1)');
  });
});
