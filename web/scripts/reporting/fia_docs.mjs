#!/usr/bin/env node
/**
 * fia_docs.mjs — official FIA event documents (tier 1, free, public).
 *
 *   node scripts/reporting/fia_docs.mjs --meeting 2026_1293
 *
 * Finds the event on fia.com's F1 documents page, lists its documents
 * (stewards' decisions, infringements, summons, classifications, notes),
 * downloads the PDFs to the raw store and extracts their text with PDFKit
 * (lib/pdftext.swift, compiled once). Writes <raw>/index.json for
 * build_reporting.mjs. Re-runs only fetch documents not already stored.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { corpusClient } from "../corpus/lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed } from "../corpus/lib/rights.mjs";
import { politeFetch } from "../corpus/lib/http.mjs";
import { ROOT, RAW_ROOT, parseMeeting, argOpt, rawDir, textOfHtml, loadMeeting, readJson, writeJson } from "./lib/common.mjs";

const SOURCE = "fia_documents";
const BASE = "https://www.fia.com";
const CHAMPIONSHIP = "fia-formula-one-world-championship-14";

/** Pure: classify a document by its title. */
export function classifyDoc(title) {
  const t = title.toLowerCase();
  if (/summons/.test(t)) return "summons";
  if (/decision|penalt|reprimand/.test(t)) return "decision";
  if (/infringement/.test(t)) return "infringement";
  if (/classification|results?\b|grid|championship points|fastest|lap times|starting/.test(t)) return "classification";
  if (/scrutineering|technical/.test(t)) return "scrutineering";
  if (/notes|preview|timetable|briefing|circuit|track|drs|weather/.test(t)) return "notes";
  return "other";
}
export const carsInTitle = (title) => [...title.matchAll(/\bCars?\s+(\d+)(?:\s*(?:and|&|,)\s*(\d+))?/gi)].flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number));

/** Pure: "06.09.26 20:30 CET" → ISO (Europe/Paris offset by month). */
export function parsePublished(text) {
  const m = /(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/.exec(text ?? "");
  if (!m) return null;
  const [, dd, mm, yy, hh, mi] = m;
  const month = Number(mm);
  const offset = month >= 4 && month <= 10 ? "+02:00" : "+01:00";
  return `20${yy}-${mm}-${dd}T${hh}:${mi}:00${offset}`;
}

/** Pure: the ajax insert-HTML → [{doc_no,title,href,published_text,published_at}]. */
export function parseDocList(html) {
  const out = [];
  const rows = html.split(/<li class="document-row/).slice(1);
  for (const r of rows) {
    const href = /href="([^"]+\.pdf)"/i.exec(r)?.[1];
    if (!href) continue;
    const title = textOfHtml(/<div class="title">([\s\S]*?)<\/div>/.exec(r)?.[1] ?? "").replace(/\s+/g, " ").trim();
    const published = textOfHtml(/Published on([\s\S]*?)<\/div>/.exec(r)?.[1] ?? "").replace(/\s+/g, " ").trim();
    const doc_no = Number(/^Doc\s+(\d+)/.exec(title)?.[1] ?? NaN);
    out.push({ doc_no: Number.isFinite(doc_no) ? doc_no : null, title: title.replace(/^Doc\s+\d+\s*-\s*/, ""), href: href.startsWith("http") ? href : BASE + href, published_text: published, published_at: parsePublished(published) });
  }
  return out;
}

function pdftextBin() {
  const bin = join(RAW_ROOT, "bin", "pdftext");
  if (!existsSync(bin)) {
    mkdirSync(join(RAW_ROOT, "bin"), { recursive: true });
    const r = spawnSync("swiftc", ["-O", "-o", bin, join(ROOT, "web", "scripts", "reporting", "lib", "pdftext.swift")], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`swiftc failed: ${r.stderr}`);
  }
  return bin;
}

if (process.argv[1] && process.argv[1].endsWith("fia_docs.mjs")) {
  const { meeting, year, meetingKey } = parseMeeting(argOpt("meeting"));
  const client = await corpusClient();
  const registry = await loadRegistry(client);
  assertAcquireAllowed(registry, SOURCE, "html");
  assertAcquireAllowed(registry, SOURCE, "pdf");
  assertUseAllowed(registry, SOURCE, "store_full_text", "reporting");
  const m = await loadMeeting(client, meetingKey);
  await client.end();
  if (!m) { console.error(`meeting ${meetingKey} not in core.meetings`); process.exit(1); }

  // 1. championship page → season page (if not current) → event id
  let page = (await politeFetch(`${BASE}/documents/championships/${CHAMPIONSHIP}`, { delayMs: 0 })).body.toString("utf8");
  const seasonHref = [...page.matchAll(new RegExp(`/documents/championships/${CHAMPIONSHIP}/season/season-${year}-\\d+`, "g"))][0]?.[0];
  if (seasonHref && !page.includes(`season-${year}`.concat("\" class=\"active"))) {
    const sp = await politeFetch(`${BASE}${seasonHref}`);
    if (sp.status === 200) page = sp.body.toString("utf8");
  }
  const events = [...page.matchAll(/href="\/decision-document-list\/nojs\/(\d+)"[^>]*>\s*([^<]{0,80})/g)].map((x) => ({ id: x[1], title: textOfHtml(x[2]).trim() }));
  const ev = events.find((e) => e.title.toLowerCase() === m.meeting_name.toLowerCase()) ?? events.find((e) => e.title.toLowerCase().includes(m.meeting_name.toLowerCase().replace(/ grand prix$/, "")));
  if (!ev) { console.error(`event "${m.meeting_name}" not found among ${events.length} events for ${year}`); process.exit(1); }
  console.log(`event ${ev.id} "${ev.title}"`);

  // 2. document list (Drupal ajax) — same content the page loads on click
  const res = await fetch(`${BASE}/decision-document-list/ajax/${ev.id}`, { headers: { "x-requested-with": "XMLHttpRequest", "user-agent": "f1chat-reporting/0.1 (personal research)" } });
  const cmds = await res.json();
  const html = cmds.filter((c) => c.command === "insert").map((c) => c.data ?? "").join("");
  const docs = parseDocList(html);
  console.log(`${docs.length} document(s) listed`);

  // 3. download + extract, incrementally
  const dir = rawDir(SOURCE, meeting);
  const index = readJson(join(dir, "index.json"), { meeting, event_id: ev.id, docs: [] });
  const have = new Map(index.docs.map((d) => [d.url, d]));
  const bin = pdftextBin();
  let added = 0;
  for (const d of docs) {
    if (have.has(d.href)) continue;
    const file = basename(new URL(d.href).pathname);
    const pdfPath = join(dir, file);
    if (!existsSync(pdfPath)) {
      const r = await politeFetch(d.href, { accept: "application/pdf" });
      if (r.status !== 200) { console.log(`  ✗ ${file}: ${r.status}`); continue; }
      writeFileSync(pdfPath, r.body);
    }
    const t = spawnSync(bin, [pdfPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    const text = t.status === 0 ? t.stdout : "";
    writeFileSync(pdfPath.replace(/\.pdf$/i, ".txt"), text);
    index.docs.push({ ...d, url: d.href, file, text_file: file.replace(/\.pdf$/i, ".txt"), doc_type: classifyDoc(d.title), cars: carsInTitle(d.title), chars: text.length });
    delete index.docs[index.docs.length - 1].href;
    added++;
    console.log(`  ✅ ${d.doc_no ?? "?"} ${d.title.slice(0, 70)} (${text.length} chars)`);
  }
  index.docs.sort((a, b) => (a.doc_no ?? 0) - (b.doc_no ?? 0));
  index.fetched_at = new Date().toISOString();
  writeJson(join(dir, "index.json"), index);
  console.log(`${added} new, ${index.docs.length} total → ${join(dir, "index.json")}`);
}
