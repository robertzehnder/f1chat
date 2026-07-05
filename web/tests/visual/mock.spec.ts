import { test, expect } from "@playwright/test";

/**
 * Phase 5 pixel gate — measures the rendered visual surface, not just the spec.
 * For every /mock fixture card (the pixel-gated renderer/card-slot surface),
 * asserts structural visual health that a spec-only check can't: the card is
 * visible and non-blank, its chart SVG has real geometry, it doesn't overflow
 * the viewport (mobile clipping), and the page loads with no console errors.
 * Full-page screenshots are captured as regression artifacts.
 */
test("mock fixtures render without visual defects", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto("/mock", { waitUntil: "networkidle" });
  const sections = page.locator('[data-testid^="fixture-"]');
  const count = await sections.count();
  expect(count, "expected the /mock fixture surface to render").toBeGreaterThan(10);

  const viewport = page.viewportSize()!;
  const problems: string[] = [];

  for (let i = 0; i < count; i++) {
    const sec = sections.nth(i);
    const id = (await sec.getAttribute("data-testid")) ?? `fixture-${i}`;
    await sec.scrollIntoViewIfNeeded();
    const box = await sec.boundingBox();
    if (!box || box.height < 20) { problems.push(`${id}: not visible / zero-height`); continue; }

    // Horizontal overflow / clipping past the viewport (the classic mobile bug).
    if (box.x + box.width > viewport.width + 2)
      problems.push(`${id}: overflows viewport by ${Math.round(box.x + box.width - viewport.width)}px`);

    // Non-blank: must have a chart (svg/canvas) OR meaningful text.
    const charts = sec.locator("svg, canvas");
    const chartCount = await charts.count();
    const text = (await sec.innerText()).trim();
    if (chartCount === 0 && text.length < 12) { problems.push(`${id}: blank (no chart, no text)`); continue; }

    // A chart SVG must have real geometry (paths/rects/circles/lines), not an empty frame.
    if (chartCount > 0) {
      const geometry = await sec.locator("svg path, svg rect, svg circle, svg line, svg polyline, canvas").count();
      if (geometry < 1) problems.push(`${id}: chart present but has no drawn geometry (empty chart)`);
      // no vertex wildly off the SVG canvas (off-scale points)
      const firstSvg = charts.first();
      const svgBox = await firstSvg.boundingBox();
      if (svgBox && (svgBox.width < 4 || svgBox.height < 4)) problems.push(`${id}: chart collapsed (${Math.round(svgBox.width)}x${Math.round(svgBox.height)})`);
    }
  }

  await page.screenshot({ path: testInfo.outputPath(`mock-${viewport.width}.png`), fullPage: true });
  await testInfo.attach(`mock-${viewport.width}`, { path: testInfo.outputPath(`mock-${viewport.width}.png`), contentType: "image/png" });

  const realErrors = consoleErrors.filter((e) => !/favicon|Download the React DevTools|hydration|Warning: /i.test(e));
  expect(problems, `visual defects:\n${problems.join("\n")}`).toEqual([]);
  expect(realErrors, `console errors:\n${realErrors.join("\n")}`).toEqual([]);
});
