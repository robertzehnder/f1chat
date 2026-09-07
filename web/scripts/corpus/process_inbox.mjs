#!/usr/bin/env node
/**
 * process_inbox.mjs — manual drop-directory intake (corpus plan).
 *
 * corpus/inbox/<name>.<ext> is ingested ONLY with a sidecar
 * corpus/inbox/<name>.source.json declaring:
 *   { "source_key": "...", "purpose": "...", "doc_type": "...",
 *     "title"?, "url"?, "published_at"?, "author"? }
 * The processor runs the SAME rights helpers as automated fetchers with the
 * DECLARED purpose — never inferred, never auto-selected from approved_uses.
 * Anything failing a check moves to corpus/quarantine/ with a reason file.
 * No manual bypass of gating.
 *
 * Usage: node scripts/corpus/process_inbox.mjs
 */
import { readdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpusClient } from "./lib/db.mjs";
import { loadRegistry, assertAcquireAllowed, assertUseAllowed, PURPOSES } from "./lib/rights.mjs";
import { storeArtifact } from "./lib/artifacts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INBOX = resolve(HERE, "..", "..", "..", "corpus", "inbox");
const QUARANTINE = resolve(HERE, "..", "..", "..", "corpus", "quarantine");

const client = await corpusClient();
const registry = await loadRegistry(client);

const files = readdirSync(INBOX).filter((f) => !f.startsWith(".") && !f.endsWith(".source.json"));
console.log(`inbox: ${files.length} file(s)`);
let ingested = 0, quarantined = 0;

function quarantine(file, sidecarFile, reason) {
  renameSync(join(INBOX, file), join(QUARANTINE, file));
  if (sidecarFile && existsSync(join(INBOX, sidecarFile))) {
    renameSync(join(INBOX, sidecarFile), join(QUARANTINE, sidecarFile));
  }
  writeFileSync(join(QUARANTINE, `${file}.reason.txt`), `${new Date().toISOString()} ${reason}\n`);
  console.error(`  ✋ ${file}: ${reason}`);
  quarantined++;
}

for (const file of files) {
  const sidecarFile = `${file.replace(/\.[^.]+$/, "")}.source.json`;
  let sidecar;
  try {
    sidecar = JSON.parse(readFileSync(join(INBOX, sidecarFile), "utf8"));
  } catch {
    quarantine(file, sidecarFile, "missing or unparseable sidecar (.source.json required)");
    continue;
  }
  const { source_key, purpose, doc_type } = sidecar;
  if (!purpose || !PURPOSES.includes(purpose)) {
    quarantine(file, sidecarFile, `sidecar missing/invalid purpose '${purpose}' (never inferred)`);
    continue;
  }
  try {
    assertAcquireAllowed(registry, source_key, "manual_inbox");
    assertUseAllowed(registry, source_key, "store_full_text", purpose);
  } catch (e) {
    quarantine(file, sidecarFile, e.message);
    continue;
  }
  const bytes = readFileSync(join(INBOX, file));
  const { sha, path } = storeArtifact(source_key, bytes);
  const { rows: [{ doc_id }] } = await client.query(
    `INSERT INTO raw.analyst_documents (source_key, source_id, url, title, author, published_at, doc_type)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7)
     ON CONFLICT (source_key, source_id) DO UPDATE SET title = EXCLUDED.title
     RETURNING doc_id`,
    [source_key, sidecar.source_id ?? basename(file), sidecar.url ?? null, sidecar.title ?? null,
     sidecar.author ?? null, sidecar.published_at ?? null, doc_type ?? "race_analysis"]);
  await client.query(
    `INSERT INTO raw.analyst_fetches (doc_id, http_status, mime_type, raw_sha256, artifact_path)
     VALUES ($1, NULL, $2, $3, $4) ON CONFLICT (doc_id, raw_sha256) DO NOTHING`,
    [doc_id, sidecar.mime_type ?? null, sha, path]);
  renameSync(join(INBOX, file), join(QUARANTINE, "..", "inbox", `.done.${file}`));
  console.log(`  + ${file} → doc ${doc_id} (${source_key}, ${purpose})`);
  ingested++;
}
console.log(`inbox: ${ingested} ingested, ${quarantined} quarantined`);
await client.end();
