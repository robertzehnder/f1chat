/**
 * parsers.mjs — deterministic, versioned normalizers (corpus plan stage 2).
 * Pure functions over raw artifact bytes so fixture-snapshot tests run
 * without a DB. Bump a parser's version when its behavior changes and
 * re-derive; old derivations remain for audit.
 *
 * NO LLM CALLS here — llm_cleanup is a separate derivation with
 * parent_derivation_id lineage (see llm_cleanup.mjs).
 */

/** the_race `.md` endpoint → { meta, text }. */
export const THERACE_MD_VERSION = "therace_md@1";
export function parseTheRaceMd(raw) {
  const src = raw.toString("utf8");
  const lines = src.split("\n");
  let i = 0;
  // leading "> ## Content Index" banner block
  while (i < lines.length && (lines[i].startsWith(">") || lines[i].trim() === "")) i++;
  const meta = { title: null, url: null, published: null, updated: null, author: null, tags: [] };
  if (lines[i]?.startsWith("# ")) { meta.title = lines[i].slice(2).trim(); i++; }
  while (i < lines.length) {
    const m = lines[i].match(/^- ([A-Za-z]+):\s*(.*)$/);
    if (!m) break;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "url") meta.url = val;
    else if (key === "published") meta.published = val;
    else if (key === "updated") meta.updated = val;
    else if (key === "author") meta.author = val;
    else if (key === "tags") meta.tags = val.split(",").map((t) => t.trim()).filter(Boolean);
    i++;
  }
  const text = lines.slice(i).join("\n").trim();
  return { meta, text };
}

/**
 * formula1.com article HTML → { meta, text } via Next.js flight-data chunks.
 * The body appears in one of two flight encodings: a quoted JSON string
 * field, or a raw text row ("<id>:T<hexlen>,<text...>") — both are scanned
 * and the longest paragraph-bearing candidate wins.
 */
export const F1COM_FLIGHT_VERSION = "f1com_flight@2";
export function parseF1comFlight(raw) {
  const html = raw.toString("utf8");
  const meta = { title: null, published: null, updated: null, author: null };
  const ld = html.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
  if (ld) {
    try {
      const d = JSON.parse(ld[1]);
      meta.title = d.headline ?? null;
      meta.published = d.datePublished ?? null;
      meta.updated = d.dateModified ?? null;
      meta.author = typeof d.author === "object" ? (d.author?.name ?? null) : (d.author ?? null);
    } catch { /* ld+json optional */ }
  }
  // Reassemble the flight blob, un-escape, fix the escape-decode mojibake
  // (unicode_escape yields latin-1 code points for multibyte UTF-8).
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/gs)].map((m) => m[1]);
  let blob = chunks.join("");
  blob = blob.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
             .replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  try { blob = Buffer.from(blob, "latin1").toString("utf8"); } catch { /* keep as-is */ }
  let body = "";
  const consider = (s) => {
    if (!s || !s.includes("\n\n")) return;
    if (s.includes("</") || s.includes("className") || s.includes('{"')) return;
    if (s.length > body.length) body = s;
  };
  // Encoding A: quoted JSON string fields with escaped newlines.
  for (const m of blob.matchAll(/"((?:[^"\\]|\\.){400,}?)"/gs)) {
    consider(m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'));
  }
  // Encoding B: raw text rows "<id>:T<hexlen>,<text>" (length in hex chars).
  for (const m of blob.matchAll(/[0-9a-f]+:T([0-9a-f]+),/g)) {
    const len = parseInt(m[1], 16);
    if (!Number.isFinite(len) || len < 400 || len > 200000) continue;
    consider(blob.slice(m.index + m[0].length, m.index + m[0].length + len));
  }
  return { meta, text: body.trim() };
}

/** substack RSS <item> content:encoded HTML → visible text (paragraph-aware). */
export const SUBSTACK_HTML_VERSION = "substack_html@1";
export function parseSubstackHtml(raw) {
  let html = raw.toString("utf8");
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  html = html.replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n");
  html = html.replace(/<[^>]+>/g, "");
  html = html.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
             .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return { meta: {}, text: html.replace(/\n{3,}/g, "\n\n").trim() };
}

/**
 * YouTube auto-caption VTT → verbatim de-duplicated transcript.
 * Rolling captions repeat each line across cues; keep each line once, in
 * order, WITHOUT changing any word. Inline timing tags stripped; a [mm:ss]
 * marker is kept roughly every 30s. THE canonical evidentiary text for
 * transcripts.
 */
export const CAPTION_DEDUP_VERSION = "caption_dedup@1";
export function parseCaptionDedup(raw) {
  const src = raw.toString("utf8");
  const cueRe = /(\d{2}):(\d{2}):(\d{2})\.\d{3} --> [\d:.]+[^\n]*\n((?:(?!\n\n)[\s\S])*)/g;
  const out = [];
  let lastLine = null;
  let lastMarkerSec = -Infinity;
  for (const m of src.matchAll(cueRe)) {
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    for (let line of m[4].split("\n")) {
      line = line.replace(/<[^>]+>/g, "").trim();
      if (!line || line === lastLine) continue;
      if (sec - lastMarkerSec >= 30) {
        out.push(`[${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}]`);
        lastMarkerSec = sec;
      }
      out.push(line);
      lastLine = line;
    }
  }
  return { meta: {}, text: out.join("\n").trim() };
}
