/**
 * artifacts.mjs — immutable raw-artifact store for the corpus pipeline.
 *
 * Bytes live OUTSIDE the DB in git-ignored corpus-artifacts/ at the repo
 * root, gzip-compressed, named by sha256 of the RAW (uncompressed) bytes,
 * grouped per source. Callers must pass assertUseAllowed(...,'store_full_text')
 * BEFORE calling storeArtifact.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ARTIFACT_ROOT = resolve(HERE, "..", "..", "..", "..", "corpus-artifacts");

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Store raw bytes; returns { sha, path } (path is repo-root-relative). */
export function storeArtifact(sourceKey, buf) {
  const sha = sha256(buf);
  const dir = join(ARTIFACT_ROOT, sourceKey.replace(/[^a-z0-9_:-]/gi, "_"));
  mkdirSync(dir, { recursive: true });
  const abs = join(dir, `${sha}.gz`);
  if (!existsSync(abs)) writeFileSync(abs, gzipSync(buf));
  return { sha, path: abs.slice(ARTIFACT_ROOT.length - "corpus-artifacts".length) };
}

export function readArtifact(relPath) {
  const abs = resolve(ARTIFACT_ROOT, "..", relPath);
  return gunzipSync(readFileSync(abs));
}

export function artifactExists(relPath) {
  return existsSync(resolve(ARTIFACT_ROOT, "..", relPath));
}
