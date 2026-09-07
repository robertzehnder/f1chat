// Corpus parser fixture-snapshot tests (corpus plan: "fixture-snapshot test
// per parser so site redesigns fail loudly"). Fixtures are SYNTHETIC — they
// mimic each source's format with our own text, because copyrighted full
// text never lands in git. If a real site changes format, the live
// normalize run errors loudly; these tests pin the parsers' contracts.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTheRaceMd,
  parseF1comFlight,
  parseSubstackHtml,
  parseCaptionDedup
} from "../corpus/lib/parsers.mjs";

test("therace_md: banner stripped, metadata parsed, body preserved", () => {
  const fixture = [
    "> ## Content Index",
    "> Fetch the complete content index at: https://example.test/llms.txt",
    "> Use this file to discover other available public pages before exploring further.",
    "",
    "# Synthetic verdict on a synthetic race",
    "- URL: https://example.test/formula-1/synthetic-verdict/",
    "- Published: 2026-09-06T18:04:28.000Z",
    "- Updated: 2026-09-06T18:43:57.000Z",
    "- Description: A synthetic description.",
    "- Author: Test Author",
    "- Tags: Formula 1, #synthetic-grand-prix",
    "",
    "The opening paragraph of the synthetic body.",
    "",
    "A second paragraph with **markdown** intact."
  ].join("\n");
  const { meta, text } = parseTheRaceMd(Buffer.from(fixture));
  assert.equal(meta.title, "Synthetic verdict on a synthetic race");
  assert.equal(meta.author, "Test Author");
  assert.equal(meta.published, "2026-09-06T18:04:28.000Z");
  assert.equal(meta.updated, "2026-09-06T18:43:57.000Z");
  assert.deepEqual(meta.tags, ["Formula 1", "#synthetic-grand-prix"]);
  assert.ok(text.startsWith("The opening paragraph"));
  assert.ok(text.includes("**markdown** intact"));
  assert.ok(!text.includes("Content Index"));
});

test("f1com_flight: ld+json meta + body recovered from flight chunks", () => {
  const body = "First synthetic paragraph about the synthetic strategy.\\n\\nSecond paragraph long enough to be the article body candidate for the parser to select from the flight data blob. ".repeat(3);
  const fixture = [
    '<html><head><script type="application/ld+json">',
    JSON.stringify({ "@type": "NewsArticle", headline: "Synthetic Strategy Guide", datePublished: "2026-08-22T20:03:56.178Z", dateModified: "2026-08-22T21:00:00.000Z" }),
    "</script></head><body>",
    `<script>self.__next_f.push([1, "prefix{\\"content\\":\\"${body}\\"}suffix"])</script>`,
    "</body></html>"
  ].join("");
  const { meta, text } = parseF1comFlight(Buffer.from(fixture));
  assert.equal(meta.title, "Synthetic Strategy Guide");
  assert.equal(meta.published, "2026-08-22T20:03:56.178Z");
  assert.equal(meta.updated, "2026-08-22T21:00:00.000Z");
  assert.ok(text.includes("First synthetic paragraph"));
  assert.ok(text.includes("\n\n"), "paragraph breaks preserved");
});

test("f1com_flight: body recovered from raw T-segment rows too", () => {
  const para = "A synthetic strategy paragraph about tyres and synthetic pit windows for the parser to find. ".repeat(3);
  const body = para + "\n\n" + para + "\n\n" + para; // > 400 chars (parser minimum)
  const hexLen = body.length.toString(16);
  const fixture = [
    "<html><body>",
    `<script>self.__next_f.push([1, "1a:T${hexLen},${body.replace(/\n/g, "\\n")}"])</script>`,
    "</body></html>"
  ].join("");
  const { text } = parseF1comFlight(Buffer.from(fixture));
  assert.ok(text.includes("synthetic strategy paragraph"));
  assert.ok(text.includes("\n\n"));
});

test("substack_html: tags stripped, paragraphs kept, entities decoded", () => {
  const fixture = "<h2>Synthetic headline</h2><p>Para one &amp; more.</p><p>Para two.</p><script>evil()</script>";
  const { text } = parseSubstackHtml(Buffer.from(fixture));
  assert.ok(text.includes("Synthetic headline"));
  assert.ok(text.includes("Para one & more."));
  assert.ok(text.includes("\n\n"));
  assert.ok(!text.includes("evil"));
});

test("caption_dedup: rolling duplicates collapsed VERBATIM, timestamps kept", () => {
  const fixture = [
    "WEBVTT",
    "Kind: captions",
    "Language: en",
    "",
    "00:00:00.000 --> 00:00:01.950 align:start position:0%",
    " ",
    "So,<00:00:00.160><c> the</c><00:00:00.240><c> synthetic</c><00:00:00.480><c> lap</c>",
    "",
    "00:00:01.950 --> 00:00:01.960 align:start position:0%",
    "So, the synthetic lap",
    " ",
    "",
    "00:00:01.960 --> 00:00:03.830 align:start position:0%",
    "So, the synthetic lap",
    "was<00:00:02.040><c> quicker</c><00:00:02.160><c> here</c>",
    "",
    "00:00:35.000 --> 00:00:36.000 align:start position:0%",
    "was quicker here",
    "and that decided it",
    ""
  ].join("\n");
  const { text } = parseCaptionDedup(Buffer.from(fixture));
  const lines = text.split("\n");
  assert.equal(lines.filter((l) => l === "So, the synthetic lap").length, 1, "rolling duplicate collapsed");
  assert.equal(lines.filter((l) => l === "was quicker here").length, 1);
  assert.ok(lines.includes("and that decided it"));
  assert.ok(lines[0].match(/^\[\d{2}:\d{2}\]$/), "timestamp marker present");
  assert.ok(text.includes("[00:35]"), "later marker after 30s");
  assert.ok(!text.includes("<c>"), "inline tags stripped");
});
