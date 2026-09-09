/**
 * verify_attribution.mjs — pure checks shared by verify_draft.mjs and tests.
 *
 * With a reporting.json present, every `attribution` claim must cite a
 * `reporting:<id>` entry that exists, and every https link in the body must
 * point at a registered entry (or the packet). Without one, attributions
 * are unchecked and the verifier says so.
 */
export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = ""; x.search = "";
    return (x.origin + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch { return String(u).trim().toLowerCase(); }
}

export function checkAttributions({ claims = [], reporting = null, body = "", context = null }) {
  const fails = [], warns = [];
  if (!reporting) {
    if (claims.some((c) => c.type === "attribution")) warns.push("no reporting.json — attribution claims are unchecked");
    return { fails, warns };
  }
  const byId = new Map((reporting.entries ?? []).map((e) => [e.id, e]));
  const ctxIds = new Set((context?.facts ?? []).map((f) => f.id));
  const urls = new Set((reporting.entries ?? []).map((e) => normalizeUrl(e.url)).filter(Boolean));
  for (const c of claims.filter((c) => c.type === "attribution")) {
    const refs = (c.refs ?? []).filter((r) => r.startsWith("reporting:") || r.startsWith("context:"));
    if (!refs.length) { fails.push(`claim ${c.id}: attribution without a reporting:<id> or context:<id> ref`); continue; }
    for (const r of refs) {
      if (r.startsWith("reporting:") && !byId.has(r.slice(10))) fails.push(`claim ${c.id}: unknown reporting entry ${r}`);
      if (r.startsWith("context:") && !ctxIds.has(r.slice(8))) fails.push(`claim ${c.id}: unknown context fact ${r}`);
    }
  }
  for (const m of body.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    const u = normalizeUrl(m[1]);
    if (!urls.has(u) && !/\/packet\.json$/.test(u)) fails.push(`unregistered source link: ${m[1].slice(0, 90)}`);
  }
  return { fails, warns };
}
