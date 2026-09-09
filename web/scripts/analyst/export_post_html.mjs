#!/usr/bin/env node
/**
 * export_post_html.mjs — freeze a published post into ONE self-contained HTML
 * file that can be e-mailed or opened from disk, keeping the figures as the
 * vector SVGs the app rendered (racing-state lane, annotations, legends, notes)
 * AND their hover tooltips.
 *
 *   node scripts/analyst/export_post_html.mjs --slug monza-2026 [--base http://localhost:3000] [--out file.html]
 *
 * How: Playwright loads /blog/<slug>, sweeps the mouse across every chart and
 * records what the live Recharts tooltip showed at each lap (label, items,
 * cursor geometry). The DOM is then serialised with all stylesheets and the
 * self-hosted fonts inlined, scripts stripped, and a small vanilla-JS replay
 * script that re-shows the recorded tooltips on hover. No network, no React.
 *
 * Output: analyst/<meeting>/<slug>.html (or --out).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const OUT = opt("out") ?? resolve(ROOT, "analyst", doc.provenance.meeting, `${SLUG}.html`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 1000 }, colorScheme: "dark" });
await page.goto(`${BASE}/blog/${SLUG}`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-figure] svg");
await page.evaluate(() => document.fonts?.ready);
await page.waitForTimeout(800);

// ---- 1. Record the live tooltips, figure by figure --------------------------
const figures = page.locator("[data-figure]");
const nFig = await figures.count();
const tooltips = {};
for (let i = 0; i < nFig; i++) {
  const fig = figures.nth(i);
  const name = await fig.getAttribute("data-figure");
  const svg = fig.locator(".recharts-wrapper > .recharts-surface").first();
  if ((await svg.count()) === 0) continue; // no Recharts surface → no tooltip (e.g. stint gantt)
  await svg.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const box = await svg.boundingBox();
  const points = [];
  const seen = new Set();
  const y = box.y + box.height * 0.55;
  for (let x = box.x + 1; x < box.x + box.width - 1; x += 2) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(25);
    const rec = await fig.evaluate((el) => {
      const wrap = el.querySelector(".recharts-tooltip-wrapper");
      if (!wrap || getComputedStyle(wrap).visibility === "hidden") return null;
      const tip = wrap.querySelector(".recharts-default-tooltip");
      const label = tip?.querySelector(".recharts-tooltip-label")?.textContent ?? "";
      const cursor = el.querySelector(".recharts-tooltip-cursor");
      const surface = el.querySelector(".recharts-wrapper > .recharts-surface");
      const sb = surface.getBoundingClientRect();
      let cx = null, cy1 = null, cy2 = null;
      if (cursor) {
        const cb = cursor.getBoundingClientRect();
        cx = (cb.left + cb.width / 2 - sb.left) / sb.width;
        cy1 = (cb.top - sb.top) / sb.height;
        cy2 = (cb.bottom - sb.top) / sb.height;
      }
      return { label, html: tip?.outerHTML ?? "", cx, cy1, cy2 };
    });
    if (!rec || !rec.label || seen.has(rec.label)) continue;
    seen.add(rec.label);
    if (rec.cx == null) rec.cx = (x - box.x) / box.width;
    points.push(rec);
  }
  tooltips[name] = { points };
  console.log(`🖱  ${name}: ${points.length} tooltip positions recorded`);
}
await page.mouse.move(0, 0);
await page.waitForTimeout(200);

// ---- 2. Serialise the page with CSS + fonts inlined --------------------------
const html = await page.evaluate(async ({ tooltips, title }) => {
  // Collect every stylesheet rule the page loaded (same-origin, so readable).
  let css = "";
  for (const sheet of Array.from(document.styleSheets)) {
    try { for (const r of Array.from(sheet.cssRules)) css += r.cssText + "\n"; } catch { /* cross-origin: skip */ }
  }
  // Inline self-hosted font files as data URIs so the file needs no server.
  const urls = [...new Set([...css.matchAll(/url\((["']?)(\/_next\/static\/media\/[^)"']+)\1\)/g)].map((m) => m[2]))];
  for (const u of urls) {
    try {
      const b = await (await fetch(u)).blob();
      const dataUri = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
      css = css.split(`url(${u})`).join(`url(${dataUri})`).split(`url("${u}")`).join(`url("${dataUri}")`);
    } catch { /* leave the url; the fallback stack still renders */ }
  }

  const root = document.documentElement.cloneNode(true);
  for (const sel of ["script", "link", "style", "noscript", "nextjs-portal", "[data-nextjs-toast]", ".recharts-tooltip-wrapper", ".recharts-tooltip-cursor", ".recharts-active-dot"]) {
    root.querySelectorAll(sel).forEach((n) => n.remove());
  }
  // Internal links are meaningless off-site: keep the text, drop the href.
  root.querySelectorAll('a[href^="/"]').forEach((a) => a.removeAttribute("href"));
  // Let the fixed-size SVGs scale down on narrow screens.
  root.querySelectorAll(".recharts-wrapper").forEach((w) => { w.style.width = "100%"; w.style.height = "auto"; w.style.position = "relative"; });
  root.querySelectorAll(".recharts-wrapper > .recharts-surface").forEach((s) => {
    if (!s.getAttribute("viewBox")) s.setAttribute("viewBox", `0 0 ${s.getAttribute("width")} ${s.getAttribute("height")}`);
    s.style.maxWidth = "100%"; s.style.height = "auto"; s.style.display = "block";
  });
  root.querySelectorAll(".recharts-responsive-container").forEach((c) => { c.style.width = "100%"; c.style.height = "auto"; });
  root.querySelectorAll(".recharts-legend-wrapper").forEach((l) => { l.style.position = "static"; l.style.width = "auto"; });

  const head = root.querySelector("head");
  head.innerHTML = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`;
  const style = document.createElement("style");
  style.textContent = css + `
.x-tip{position:absolute;pointer-events:none;z-index:10;display:none}
.x-cursor{position:absolute;pointer-events:none;width:1px;background:hsl(var(--muted-foreground));opacity:.35;display:none}
`;
  head.appendChild(style);

  const replay = document.createElement("script");
  replay.textContent = `
(function(){
  var T=${JSON.stringify(tooltips)};
  document.querySelectorAll('[data-figure]').forEach(function(fig){
    var d=T[fig.getAttribute('data-figure')]; if(!d||!d.points.length) return;
    var wrap=fig.querySelector('.recharts-wrapper'); var svg=wrap&&wrap.querySelector('.recharts-surface'); if(!svg) return;
    var tip=document.createElement('div'); tip.className='x-tip'; wrap.appendChild(tip);
    var cur=document.createElement('div'); cur.className='x-cursor'; wrap.appendChild(cur);
    function hide(){tip.style.display='none';cur.style.display='none';}
    svg.addEventListener('mousemove',function(e){
      var b=svg.getBoundingClientRect(); var fx=(e.clientX-b.left)/b.width;
      var best=d.points[0]; d.points.forEach(function(p){ if(Math.abs(p.cx-fx)<Math.abs(best.cx-fx)) best=p; });
      if(Math.abs(best.cx-fx)>0.03){hide();return;}
      tip.innerHTML=best.html; tip.style.display='block';
      var wb=wrap.getBoundingClientRect(); var px=b.left-wb.left+best.cx*b.width; var py=e.clientY-wb.top;
      var tw=tip.offsetWidth; var left=px+14; if(left+tw>wb.width) left=px-14-tw;
      tip.style.left=Math.max(0,left)+'px'; tip.style.top=Math.max(0,Math.min(py-12,wb.height-tip.offsetHeight))+'px';
      if(best.cy1!=null){cur.style.display='block';cur.style.left=px+'px';cur.style.top=(b.top-wb.top+best.cy1*b.height)+'px';cur.style.height=((best.cy2-best.cy1)*b.height)+'px';}
    });
    svg.addEventListener('mouseleave',hide);
  });
})();`;
  root.querySelector("body").appendChild(replay);
  return "<!doctype html>\n" + root.outerHTML;
}, { tooltips, title: `${doc.title} — F1 Chat` });

await browser.close();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`✅ ${OUT} (${(Buffer.byteLength(html) / 1024).toFixed(0)} kB, ${Object.keys(tooltips).length} interactive figures)`);
