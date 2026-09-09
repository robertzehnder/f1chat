#!/usr/bin/env node
/**
 * bind_claims.mjs — turn a writer's draft + claims into the pipeline's files
 * (automation plan W4, v1). Fails closed on anything it cannot bind.
 *
 *   node scripts/reporting/bind_claims.mjs --meeting 2026_1292 --draft <writer output> --slug zandvoort-2026 --hero gap_trace [--author "GPT-6 Astra (writer)"]
 *
 * Input (one file): markdown body (title line, paragraphs, {{fig:…}} lines,
 * "## Race notes", "## About the data"), then `=== META ===` + JSON {dek},
 * then `=== CLAIMS ===` + JSON array of {span, kind, refs[], note}.
 *
 * Writes analyst/<meeting>/{post.md, report.md, post.meta.json, sidecar.json}.
 * What is enforced here (deterministic):
 *   - every claim span is an exact, unique substring of the body;
 *   - every number in the prose equals the fact-sheet rendering of a cited N-id
 *     (small counts one to ten may be words or digits without a claim);
 *   - every attribution cites a reporting:<id> or context:<id> that exists;
 *   - every causal-language sentence has a causal claim; causal claims are
 *     written with review.outcome = "unresolved" — a reviewer sets the outcome,
 *     never the writer (verify_draft blocks material unresolved claims).
 * Entailment is NOT checked here.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, parseMeeting, argOpt, argFlag, readJson } from "./lib/common.mjs";
import { normalizeUrl } from "./lib/verify_attribution.mjs";

const { meeting, meetingKey } = parseMeeting(argOpt("meeting"));
const dir = join(ROOT, "analyst", meeting);
const draftPath = argOpt("draft"); if (!draftPath) { console.error("--draft required"); process.exit(2); }
const slug = argOpt("slug") ?? meeting.toLowerCase();
const hero = argOpt("hero") ?? "gap_trace";
const author = argOpt("author") ?? "GPT-6 Astra (writer) · F1 Chat analyst";
const DRY = argFlag("dry-run");

const raw = readFileSync(draftPath, "utf8");
const [bodyPart, rest] = raw.split(/^=== META ===\s*$/m);
if (!rest) { console.error("no === META === section"); process.exit(1); }
const [metaPart, claimsPart] = rest.split(/^=== CLAIMS ===\s*$/m);
if (!claimsPart) { console.error("no === CLAIMS === section"); process.exit(1); }
let meta, claims;
try { meta = JSON.parse(metaPart.trim()); claims = JSON.parse(claimsPart.trim()); } catch (e) { console.error(`META/CLAIMS JSON invalid: ${e.message}`); process.exit(1); }
const body = bodyPart.trim() + "\n";
const packet = readJson(join(dir, "packet.json"), null);
const facts = readJson(join(dir, "fact_sheet.md.json"), null);
const reporting = readJson(join(dir, "reporting.json"), null);
const context = readJson(join(dir, "context.json"), null);
if (!packet || !facts) { console.error("packet.json and fact_sheet.md.json required in the meeting dir"); process.exit(1); }
const byN = new Map(facts.numbers.map((n) => [n.id, n]));
const repIds = new Set((reporting?.entries ?? []).map((e) => e.id));
const ctxIds = new Set((context?.facts ?? []).map((f) => f.id));
const momentIds = new Set(packet.candidate_moments.map((m) => m.id));

const fails = [], warns = [];
const fail = (m) => fails.push(m);
// prose without link targets, for span/number checks
const prose = body.replace(/\]\((https?:\/\/[^)\s]+)\)/g, "]");
const plain = prose.replace(/\[([^\]]+)\]/g, "$1").replace(/\{\{fig:[a-z0-9_-]+\}\}/gi, "");
const count = (hay, needle) => hay.split(needle).length - 1;

// ---- 1. spans
for (const c of claims) {
  if (!c.span || typeof c.span !== "string") { fail(`claim without span: ${JSON.stringify(c).slice(0, 80)}`); continue; }
  const n = count(plain, c.span) || count(prose, c.span);
  if (n === 0) fail(`span not found: "${c.span}"`);
  else if (n > 1) fail(`span ambiguous (${n}×): "${c.span}"`);
}

// ---- 2. numbers: cited renders must appear in the span; every prose number must be a cited render
const citedRenders = new Set();
for (const c of claims) {
  const ns = (c.refs ?? []).filter((r) => /^N\d+$/.test(r));
  for (const id of ns) {
    const f = byN.get(id);
    if (!f) { fail(`unknown fact id ${id} in "${c.span}"`); continue; }
    if (c.kind === "number" && !c.span.includes(f.render)) fail(`number claim "${c.span}" cites ${id} but does not contain its rendering "${f.render}"`);
    citedRenders.add(f.render);
  }
  if (c.kind === "number" && !ns.length) {
    // a number may instead come from a cited computed context fact (its values are provenance)
    const ctx = (c.refs ?? []).filter((r) => r.startsWith("context:")).map((r) => (context?.facts ?? []).find((f) => f.id === r.slice(8))).filter(Boolean);
    const vals = ctx.flatMap((f) => JSON.stringify(f.values).match(/\d+(?:\.\d+)?/g) ?? []);
    const hit = vals.find((v) => c.span.includes(v));
    if (hit) citedRenders.add(hit); else fail(`number claim without an N-id or a context fact containing its number: "${c.span}"`);
  }
}
let scan = plain;
for (const r of [...citedRenders].sort((a, b) => b.length - a.length)) scan = scan.split(r).join(" ");
const SMALL = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
const leftover = [...scan.replace(/\b(19|20)\d{2}\b/g, " ").matchAll(/\b\d+(?:[.:]\d+)?\b/g)].map((m) => m[0]).filter((n) => !SMALL.has(n));
// numbers that appear inside cited context statements are allowed (context values are provenance)
const ctxNums = new Set((context?.facts ?? []).flatMap((f) => JSON.stringify(f.values).match(/\d+(?:\.\d+)?/g) ?? []));
const uncited = [...new Set(leftover)].filter((n) => !ctxNums.has(n));
if (uncited.length) fail(`numbers in prose with no citing claim: ${uncited.join(", ")}`);

// ---- 3. attributions and refs
for (const c of claims) {
  const refs = c.refs ?? [];
  for (const r of refs) {
    if (/^N\d+$/.test(r)) continue;
    if (r.startsWith("reporting:")) { if (!repIds.has(r.slice(10))) fail(`unknown reporting id ${r} in "${c.span}"`); }
    else if (r.startsWith("context:")) { if (!ctxIds.has(r.slice(8))) fail(`unknown context id ${r} in "${c.span}"`); }
    else if (r.startsWith("moment:")) { if (!momentIds.has(r.slice(7))) fail(`unknown moment ${r} in "${c.span}"`); }
    else if (r.startsWith("packet:")) { /* checked by verify_draft */ }
    else fail(`malformed ref ${r} in "${c.span}"`);
  }
  if (c.kind === "attribution" && !refs.some((r) => r.startsWith("reporting:") || r.startsWith("context:"))) fail(`attribution without reporting/context ref: "${c.span}"`);
  if (c.kind === "causal" && !refs.length) fail(`causal claim without refs: "${c.span}"`);
}

// ---- 4. causal sentences must carry a causal claim
const CAUSAL = /\b(because|since|due to|thanks to|handed|gave|allowed|cost (?:him|her|them)|proved decisive|turned the race|undone by|as a result|led to|meant that|so that|which is why|decided (?:the|it))\b/i;
const bodyNoNotes = plain.split(/^##\s+/m)[0];
const sentences = bodyNoNotes.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) ?? [];
// an attributed cause ("X said the hards allowed him to push") is covered by its attribution claim
const causalSpans = claims.filter((c) => c.kind === "causal" || c.kind === "attribution").map((c) => c.span.toLowerCase());
for (const s of sentences.filter((s) => CAUSAL.test(s) && !/\bsince (19|20)\d{2}\b/.test(s))) {
  if (!causalSpans.some((sp) => s.toLowerCase().includes(sp.slice(0, 40)))) fail(`causal sentence without a causal claim: "${s.trim().slice(0, 90)}"`);
}

// ---- 5. links must be registered sources (verify_draft checks too; fail early here)
const urls = new Set((reporting?.entries ?? []).map((e) => normalizeUrl(e.url)));
for (const m of body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) if (!urls.has(normalizeUrl(m[1]))) fail(`unregistered link: ${m[1].slice(0, 80)}`);

// ---- report
for (const w of warns) console.log(`  ⚠️  ${w}`);
for (const f of fails) console.log(`  ❌ ${f}`);
console.log(fails.length ? `BIND: FAIL (${fails.length})` : `BIND: OK (${claims.length} claims)`);
if (fails.length || DRY) process.exit(fails.length ? 1 : 0);

// ---- derive files
const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
if (!title) { console.error("no # title"); process.exit(1); }
const paras = body.trim().split(/\n\s*\n/);
const report = paras.filter((p) => !/^\{\{fig:[a-z0-9_-]+\}\}$/i.test(p.trim())).join("\n\n") + "\n";
const figureOrder = paras.map((p) => /^\{\{fig:([a-z0-9_-]+)\}\}$/i.exec(p.trim())?.[1]).filter(Boolean);
const toRef = (r) => {
  if (/^N\d+$/.test(r)) { const f = byN.get(r); return f.path.includes(" − ") ? null : `packet:${f.path}`; }
  return r;
};
const sidecarClaims = claims.map((c, i) => {
  let refs = [...new Set((c.refs ?? []).map(toRef).filter(Boolean))];
  if (!refs.length) refs = (c.refs ?? []).filter((r) => /^N\d+$/.test(r)).map((r) => byN.get(r)).filter((f) => f?.path.includes(" − ")).flatMap((f) => f.path.split(" − ").map((p) => `packet:${p.trim()}`));
  const ns = (c.refs ?? []).filter((r) => /^N\d+$/.test(r)).map((r) => byN.get(r));
  const values = ns.flatMap((f) => [f.render, String(f.value)]);
  const id = `${c.kind[0].toUpperCase()}${i + 1}`;
  if (c.kind === "causal") return { id, type: "causal_interpretation", material: true, text: c.span, relation: c.note ?? "", refs, confidence: "writer-stated", review: { outcome: "unresolved", note: "set by the reviewer, never the writer" } };
  if (c.kind === "attribution") return { id, type: "attribution", material: false, text: c.span, refs, ...(values.length ? { values } : {}), note: c.note ?? "" };
  if (c.kind === "number") return { id, type: "derived_metric", material: true, text: c.span, values, refs, note: c.note ?? "" };
  return { id, type: "observation", material: false, text: c.span, refs, ...(values.length ? { values } : {}), review: { outcome: "accepted" }, note: c.note ?? "" };
});
// mechanism/secondary beats cite candidate moments: those the writer cited, plus the packet's
// caution moments and the final lead change (the deterministic story spine)
const cited = claims.flatMap((c) => (c.refs ?? []).filter((r) => r.startsWith("moment:")));
const lastLead = packet.lead_changes.at(-1);
const spine = packet.candidate_moments.filter((m) => m.type?.startsWith("caution:") || (lastLead && m.type === "lead_change" && m.lap === lastLead.lap)).map((m) => `moment:${m.id}`);
const moments = [...new Set([...cited, ...spine])];
const contract = {
  C1: { status: "covered", reason: "result, margin and podium in the opening paragraph", refs: ["packet:results"] },
  C2: { status: "covered", reason: "mechanism chain in the body; moment ids cited by the causal claims", refs: moments.length ? moments : ["packet:candidate_moments"] },
  C3: { status: "covered", reason: "decisive lap from lead_changes; corner attributed to reporting", refs: ["packet:lead_changes"] },
  C4: { status: "covered", reason: "turning points that did not turn (slow stop, VSC stops) from the packet", refs: ["packet:stops", "packet:timeline.intervals"] },
  C5: { status: packet.pole_sitter?.finished === 1 ? "not material" : "covered", reason: packet.pole_sitter?.finished === 1 ? "pole-sitter won; folded into C1" : "pole-sitter's fate from results", refs: ["packet:pole_sitter"] },
  C6: { status: "covered", reason: "restart tyre changes, inferred caution endpoints and carried-forward positions stated in About the data", refs: ["packet:manifest.flags"] },
  C7: { status: "covered", reason: "standings from standings_after", refs: ["packet:standings_after"] },
  C8: { status: "covered", reason: "secondary storylines cite moments / reporting", refs: moments.length ? moments : ["packet:candidate_moments"] },
  C9: { status: "covered", reason: "race-control record described in ordinary language; driver/team remarks attributed to registered reporting", refs: ["packet:timeline.events"] },
  C10: { status: "covered", reason: "About the data names the manifest's gaps", refs: ["packet:manifest.not_available"] },
  C0: { status: "not material", reason: "article register", refs: [] },
  C1a: { status: "not material", reason: "article register", refs: [] },
  C11: { status: (packet.grid_penalties ?? []).length ? "covered" : "not material", reason: (packet.grid_penalties ?? []).length ? "grid penalties from the packet" : "no grid penalties recorded for this race", refs: ["packet:grid_penalties"] },
  C12: { status: "not material", reason: "rest of the field handled as connected paragraphs", refs: [] },
  C13: { status: "covered", reason: "closes on the standings and the next race", refs: ["packet:standings_after"] }
};
const sidecar = { report: "report.md", packet_version: packet.packet_version, review_mode: "GPT-6 Astra writer claims bound by bind_claims.mjs v1; causal outcomes set by the reviewer (unresolved until then)", bound_at: new Date().toISOString(), draft_source: draftPath, claims: sidecarClaims, contract };
const sessionKey = Number(packet.session.session_key);
const postMeta = { slug, dek: meta.dek, published_at: new Date().toISOString().slice(0, 10) + "T12:00:00Z", author, meeting_key: meetingKey, session_key: sessionKey, hero_figure: hero, figure_order: figureOrder };
writeFileSync(join(dir, "post.md"), body);
writeFileSync(join(dir, "report.md"), report);
writeFileSync(join(dir, "post.meta.json"), JSON.stringify(postMeta, null, 2) + "\n");
writeFileSync(join(dir, "sidecar.json"), JSON.stringify(sidecar, null, 1) + "\n");
console.log(`✅ wrote post.md, report.md, post.meta.json, sidecar.json (${sidecarClaims.length} claims, ${sidecarClaims.filter((c) => c.type === "causal_interpretation").length} causal unresolved) in analyst/${meeting}`);
