import { describe, expect, it } from "vitest";
import { parseThemeCookie } from "~/lib/theme";

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("theme", () => {
  it("parses cookie with system fallback", () => {
    expect(parseThemeCookie("a=1; theme=dark")).toBe("dark");
    expect(parseThemeCookie("theme=evil")).toBe("system");
    expect(parseThemeCookie(null)).toBe("system");
  });
  it("keeps AA contrast for key token pairs", () => {
    const pairs: [string, string][] = [
      ["#ffffff", "#b94e25"],
      ["#171514", "#f7f3ee"],
      ["#6b5a50", "#f7f3ee"],
      ["#141312", "#d8612f"],
      ["#f7f3ee", "#141312"],
      ["#b8a99d", "#141312"],
    ];
    for (const [a, b] of pairs) expect(contrast(a, b), `${a} on ${b}`).toBeGreaterThanOrEqual(4.5);
  });
});
