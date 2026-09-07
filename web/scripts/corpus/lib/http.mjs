/**
 * http.mjs — polite fetch for corpus scripts: descriptive UA with contact,
 * per-call politeness delay (default 600ms), conditional-GET helpers.
 */
export const UA = "f1chat-corpus-research/0.1 (personal research; rjzehnder@gmail.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function politeFetch(url, { etag, delayMs = 600, accept } = {}) {
  await sleep(delayMs);
  const headers = { "user-agent": UA };
  if (etag) headers["if-none-match"] = etag;
  if (accept) headers.accept = accept;
  const res = await fetch(url, { headers, redirect: "follow" });
  const body = res.status === 304 ? null : Buffer.from(await res.arrayBuffer());
  return {
    status: res.status,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
    mimeType: res.headers.get("content-type"),
    body
  };
}
