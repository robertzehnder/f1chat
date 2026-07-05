// Export each 2025 circuit's real outline (from raw.location reference lap) as a
// clean PNG for design reference. Replicates /api/track-outline's reference-lap
// pick, but runs direct-to-Neon via psql (no Next server). Renders with sharp.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..");
const OUT = join(WEB, "..", "diagnostic", "design-review-2026-07-03", "track-maps");
mkdirSync(OUT, { recursive: true });

// env
const env = {};
for (const l of readFileSync(join(WEB, ".env.local"), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const PG = {
  host: env.NEON_DB_HOST, port: env.NEON_DB_PORT || "5432",
  user: env.NEON_DB_USER, db: env.NEON_DB_NAME, pass: env.NEON_DB_PASSWORD,
};

// 2025 calendar order → circuit_short_name → display → slug
const CIRCUITS = [
  [1,"Melbourne","Melbourne · Australia","melbourne"],
  [2,"Shanghai","Shanghai · China","shanghai"],
  [3,"Suzuka","Suzuka · Japan","suzuka"],
  [4,"Sakhir","Sakhir · Bahrain","sakhir"],
  [5,"Jeddah","Jeddah · Saudi Arabia","jeddah"],
  [6,"Miami","Miami · USA","miami"],
  [7,"Imola","Imola · Italy","imola"],
  [8,"Monte Carlo","Monte Carlo · Monaco","monaco"],
  [9,"Catalunya","Barcelona · Spain","barcelona"],
  [10,"Montreal","Montreal · Canada","montreal"],
  [11,"Spielberg","Red Bull Ring · Austria","red_bull_ring"],
  [12,"Silverstone","Silverstone · UK","silverstone"],
  [13,"Spa-Francorchamps","Spa · Belgium","spa"],
  [14,"Hungaroring","Hungaroring · Hungary","hungaroring"],
  [15,"Zandvoort","Zandvoort · Netherlands","zandvoort"],
  [16,"Monza","Monza · Italy","monza"],
  [17,"Baku","Baku · Azerbaijan","baku"],
  [18,"Singapore","Marina Bay · Singapore","singapore"],
  [19,"Austin","Austin · USA","austin"],
  [20,"Mexico City","Mexico City · Mexico","mexico"],
  [21,"Interlagos","Interlagos · Brazil","interlagos"],
  [22,"Las Vegas","Las Vegas · USA","las_vegas"],
  [23,"Lusail","Lusail · Qatar","lusail"],
  [24,"Yas Marina Circuit","Yas Marina · UAE","yas_marina"],
];

function pointsFor(circuit) {
  const q = `
    WITH sess AS (
      SELECT session_key FROM raw.sessions
      WHERE circuit_short_name = '${circuit.replace(/'/g, "''")}' AND year=2025 AND session_type='Race'
      ORDER BY date_start DESC LIMIT 4
    ),
    ref AS (
      SELECT le.session_key, le.driver_number, le.lap_start_ts, le.lap_end_ts
      FROM core.laps_enriched le JOIN sess s ON s.session_key=le.session_key
      WHERE le.lap_duration IS NOT NULL AND COALESCE(le.is_valid,TRUE)=TRUE
        AND COALESCE(le.is_pit_lap,FALSE)=FALSE AND COALESCE(le.is_pit_out_lap,FALSE)=FALSE
        AND le.lap_start_ts IS NOT NULL AND le.lap_end_ts IS NOT NULL
      ORDER BY le.lap_duration ASC LIMIT 1
    )
    SELECT l.x, l.y FROM raw.location l JOIN ref r
      ON l.session_key=r.session_key AND l.driver_number=r.driver_number
      AND l.date BETWEEN r.lap_start_ts AND r.lap_end_ts
    WHERE l.x IS NOT NULL AND l.y IS NOT NULL
    ORDER BY l.date`;
  const out = execFileSync("psql", [
    "-h", PG.host, "-p", PG.port, "-U", PG.user, "-d", PG.db,
    "-tA", "-F", ",", "-v", "ON_ERROR_STOP=1", "-c", q,
  ], { env: { ...process.env, PGPASSWORD: PG.pass }, maxBuffer: 64 * 1024 * 1024, timeout: 60000 }).toString();
  return out.trim().split("\n").filter(Boolean).map((r) => r.split(",").map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
}

function svgFor(pts, label) {
  const W = 760, H = 820, PAD = 70, LABEL_H = 60;
  const plotH = H - LABEL_H;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const bw = maxX - minX || 1, bh = maxY - minY || 1;
  const scale = Math.min((W - 2 * PAD) / bw, (plotH - 2 * PAD) / bh);
  const ox = (W - bw * scale) / 2, oy = (plotH - bh * scale) / 2;
  // y-flip: world y up → svg y down
  const proj = (p) => [ox + (p[0] - minX) * scale, oy + (maxY - p[1]) * scale];
  const d = pts.map((p, i) => { const [x, y] = proj(p); return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ") + " Z";
  const [sx, sy] = proj(pts[0]);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="20" fill="#1a181b"/>
  <path d="${d}" fill="none" stroke="#f2f2f2" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9" fill="#E10600"/>
  <text x="${W / 2}" y="${H - 22}" fill="#c9c7ca" font-family="ui-monospace, Menlo, monospace" font-size="26" letter-spacing="1.5" text-anchor="middle">${label}</text>
</svg>`;
}

const results = [];
for (const [round, circuit, display, slug] of CIRCUITS) {
  const name = String(round).padStart(2, "0") + "_" + slug;
  try {
    const pts = pointsFor(circuit);
    if (pts.length < 100) { console.log(`SKIP ${name}: only ${pts.length} points`); results.push({ round, display, slug, ok: false, reason: `${pts.length} points` }); continue; }
    const svg = svgFor(pts, display.toUpperCase());
    writeFileSync(join(OUT, name + ".svg"), svg);
    await sharp(Buffer.from(svg)).png().toFile(join(OUT, name + ".png"));
    console.log(`OK   ${name}.png  (${pts.length} pts)`);
    results.push({ round, display, slug, ok: true, points: pts.length });
  } catch (e) {
    console.log(`ERR  ${name}: ${String(e.message).slice(0, 80)}`);
    results.push({ round, display, slug, ok: false, reason: String(e.message).slice(0, 80) });
  }
}
writeFileSync(join(OUT, "_manifest.json"), JSON.stringify(results, null, 2));
console.log(`\nDone: ${results.filter((r) => r.ok).length}/${CIRCUITS.length} circuits → ${OUT}`);
