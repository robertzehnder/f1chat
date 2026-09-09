#!/usr/bin/env node
/**
 * export_figures.mjs — render each figure of a post through the bare figure
 * route and save PNGs (visuals plan S1.6-lite: local files, no Blob yet).
 *
 *   node scripts/analyst/export_figures.mjs --slug monza-2026 [--base http://localhost:3000]
 *
 * Writes web/public/blog/<slug>/<name>.png (served as og:image / social) and
 * analyst/<meeting>/figures/<name>.png (kept with the evidence).
 */
import { mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..");
const argv = process.argv.slice(2);
const opt = (k) => argv.find((a, i) => argv[i - 1] === `--${k}`);
const SLUG = opt("slug") ?? "monza-2026";
const BASE = opt("base") ?? "http://localhost:3000";
const doc = JSON.parse(readFileSync(resolve(ROOT, "web", "content", "blog", `${SLUG}.json`), "utf8"));
const PUB = resolve(ROOT, "web", "public", "blog", SLUG);
const FIG = resolve(ROOT, "analyst", doc.provenance.meeting, "figures");
mkdirSync(PUB, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
for (const name of Object.keys(doc.figures)) {
  await page.goto(`${BASE}/blog/${SLUG}/figure/${name}`, { waitUntil: "networkidle" });
  await page.waitForSelector("svg, [data-figure]");
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(600);
  const root = page.locator("[data-export-root]");
  const out = resolve(PUB, `${name}.png`);
  await root.screenshot({ path: out, animations: "disabled" });
  copyFileSync(out, resolve(FIG, `${name}.png`));
  console.log(`✅ ${name} → public/blog/${SLUG}/${name}.png`);
}
await browser.close();
