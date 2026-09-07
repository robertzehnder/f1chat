/**
 * anthropic.mjs — minimal streaming Messages call for corpus scripts.
 * Raw fetch + SSE (the app carries no SDK dependency); streaming keeps the
 * connection alive through multi-minute generations. Returns the
 * concatenated text output. Callers gate with assertUseAllowed first.
 */
export async function anthropicStream({ model, max_tokens, system, messages }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({ model, max_tokens, system, messages, stream: true })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  let text = "";
  let buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
      if (ev.type === "error") throw new Error(`stream error: ${JSON.stringify(ev.error).slice(0, 200)}`);
    }
  }
  return text;
}
