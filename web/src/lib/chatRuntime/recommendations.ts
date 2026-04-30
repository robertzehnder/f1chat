function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function isFollowUp(message: string): boolean {
  const lower = normalize(message);
  return /^(and|also|now|then|what about|how about|just)\b/.test(lower);
}
