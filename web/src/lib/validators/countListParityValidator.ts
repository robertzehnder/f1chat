import type { FactContract } from "@/lib/contracts/factContract";

export type CountListParityValidationResult = {
  ok: boolean;
  reasons: string[];
};

type CountClaim = {
  count: number;
  entity: string;
  startIdx: number;
  endIdx: number;
};

// Plural-noun units that are not enumerable items (durations, distances, etc.)
// We exclude these from claim parsing so "30 seconds" or "5 kilometers" do not
// trigger the validator.
const NON_ENUMERABLE_LAST_WORD =
  /^(seconds?|minutes?|hours?|days?|weeks?|months?|years?|kilometers?|kilometres?|meters?|metres?|miles?|kph|mph|degrees?|percent|millimeters?|millimetres?|centimeters?|centimetres?)$/i;

// Match `<digit-run> <one-or-two lowercase words ending in 's'>`.
// Example matches: "3 pit stops", "2 sectors", "5 laps".
const COUNT_CLAIM_RE =
  /\b(\d+)\s+((?:[a-z][a-zA-Z\-]*\s+)?[a-z][a-zA-Z\-]*s)\b/g;

function parseCountClaims(text: string): CountClaim[] {
  const claims: CountClaim[] = [];
  COUNT_CLAIM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COUNT_CLAIM_RE.exec(text)) !== null) {
    if (m.index > 0) {
      const prev = text.charAt(m.index - 1);
      if (prev === "." || (prev >= "0" && prev <= "9")) continue;
    }
    const count = Number(m[1]);
    if (!Number.isFinite(count) || count < 0) continue;
    const entity = m[2].trim();
    const words = entity.split(/\s+/);
    const lastWord = words[words.length - 1];
    if (!lastWord || lastWord.length < 3) continue;
    if (NON_ENUMERABLE_LAST_WORD.test(lastWord)) continue;
    claims.push({
      count,
      entity,
      startIdx: m.index,
      endIdx: m.index + m[0].length
    });
  }
  return claims;
}

function findMarkdownListLength(window: string): number | null {
  const firstNewlineIdx = window.indexOf("\n");
  if (firstNewlineIdx === -1) return null;
  const after = window.slice(firstNewlineIdx + 1);
  const lines = after.split(/\n/);
  let listLength = 0;
  let started = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (started) break;
      continue;
    }
    const isBullet = /^[-*•]\s+/.test(trimmed);
    const isNumbered = /^\d+[.)]\s+/.test(trimmed);
    if (isBullet || isNumbered) {
      listLength++;
      started = true;
    } else {
      break;
    }
  }
  return listLength > 0 ? listLength : null;
}

function findInlineEnumerationLength(sentence: string): number | null {
  const numCommaAndRe = /\b\d+(?:\s*,\s*\d+)+(?:\s*,?\s+(?:and|&)\s+\d+)?/;
  const numAndRe = /\b\d+\s+(?:and|&)\s+\d+\b/;
  const m1 = sentence.match(numCommaAndRe);
  if (m1) {
    const nums = m1[0].match(/\d+/g) ?? [];
    if (nums.length >= 2) return nums.length;
  }
  const m2 = sentence.match(numAndRe);
  if (m2) {
    const nums = m2[0].match(/\d+/g) ?? [];
    if (nums.length >= 2) return nums.length;
  }
  const wordEnumRe =
    /\b[A-Z][a-zA-Z'\-]+(?:\s*,\s*[A-Z][a-zA-Z'\-]+)+(?:\s*,?\s+(?:and|&)\s+[A-Z][a-zA-Z'\-]+)?/;
  const m3 = sentence.match(wordEnumRe);
  if (m3) {
    const items = m3[0]
      .split(/\s*,\s*|\s+(?:and|&)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (items.length >= 2) return items.length;
  }
  return null;
}

function findListLengthForClaim(text: string, claimEnd: number): number | null {
  const remaining = text.slice(claimEnd);
  const paragraphEnd = remaining.search(/\n\s*\n/);
  const window = paragraphEnd === -1 ? remaining : remaining.slice(0, paragraphEnd);

  const mdLen = findMarkdownListLength(window);
  if (mdLen !== null) return mdLen;

  const sentEnd = remaining.search(/[.!?\n]/);
  const sentence = sentEnd === -1 ? remaining : remaining.slice(0, sentEnd);
  return findInlineEnumerationLength(sentence);
}

export function validateCountListParity(
  answerText: string,
  _contract: FactContract
): CountListParityValidationResult {
  if (typeof answerText !== "string" || answerText.length === 0) {
    return { ok: true, reasons: [] };
  }
  const claims = parseCountClaims(answerText);
  if (claims.length === 0) {
    return { ok: true, reasons: [] };
  }
  const reasons: string[] = [];
  for (const claim of claims) {
    const listLen = findListLengthForClaim(answerText, claim.endIdx);
    if (listLen === null) {
      reasons.push(
        `Count claim '${claim.count} ${claim.entity}' has no corresponding listed enumeration in the answer to verify against`
      );
      continue;
    }
    if (listLen !== claim.count) {
      reasons.push(
        `Count claim '${claim.count} ${claim.entity}' disagrees with listed-item count ${listLen}`
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}
