/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = process.cwd();

function relativeLuminance(hex: string) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/gu)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe("production performance contracts", () => {
  it("keeps the active 9px event index at WCAG AA contrast", () => {
    const css = readFileSync(resolve(webRoot, "src/styles.css"), "utf8");
    expect(css).toMatch(/--red-text:\s*#b91c1c/iu);
    expect(css).toMatch(
      /\.event-row--active \.event-index\s*\{[^}]*color:\s*var\(--red-text\)/isu,
    );
    expect(contrastRatio("#B91C1C", "#FEF2F2")).toBeGreaterThanOrEqual(4.5);
  });

  it("declares a relative code-native SVG favicon for nested static hosting", () => {
    const html = readFileSync(resolve(webRoot, "index.html"), "utf8");
    const favicon = readFileSync(resolve(webRoot, "public/favicon.svg"), "utf8");
    expect(html).toContain('<link rel="icon" href="./favicon.svg" type="image/svg+xml" />');
    expect(favicon).toMatch(/^<svg\b/u);
    expect(favicon).toContain('fill="#111827"');
    expect(favicon).not.toMatch(/<(?:image|script)\b|(?:href|src)=["']https?:/iu);
  });

  it("serves an explicit allow-all robots policy instead of the SPA document", () => {
    const robots = readFileSync(resolve(webRoot, "public/robots.txt"), "utf8");
    expect(robots.replace(/\r\n/gu, "\n")).toBe("User-agent: *\nAllow: /\n");
  });
});
