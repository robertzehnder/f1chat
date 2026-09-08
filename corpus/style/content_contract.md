# Content contract — race recap (analyst design U2)

Separate from the voice guide (composite_voice_v1.md). Every beat below must be
RESOLVED in the claims sidecar as one of `covered` / `not material` /
`not available`, each with a one-line reason. Resolution is mandatory; prose
is not — a beat that is not material is simply absent from the piece.
Checklist-shaped writing violates the interpret-don't-narrate rule.

| id | Beat | Resolution guidance |
|----|------|---------------------|
| C1 | Result + margin | Winner, margin, podium. Almost always `covered`. |
| C2 | The mechanism — how the winner got there | MUST cite ≥1 candidate moment id AND the relevant caution/anomaly window record. A mechanism without a window reference is unverified. |
| C3 | The decisive moment | Lap always; corner ONLY when the packet's evidence supports it (else the corner is `not available`). |
| C4 | Near-misses / turning points that didn't turn | From anomaly windows; cause stated only if the window shows it, else "cause unknown". |
| C5 | Pole-sitter's fate | `covered` unless the pole-sitter won (then folded into C1). |
| C6 | Caveats to the headline stat | Restart snapshots ("started 19th, restarted 12th"), red-flag tyre changes, penalties applied post-race. |
| C7 | Championship arithmetic | Points before/after from the packet's standings block. |
| C8 | Secondary storylines | Selected by candidate salience OR strategic significance — never by position swing alone. Each cites a moment id. |
| C9 | Evidentiary quotation | Race-control messages quoted VERBATIM are the official record we own; driver/team quotation is `not available` (not in the warehouse) and must be marked so — the two are not interchangeable. |
| C10 | What the data cannot see | Stated plainly from the packet manifest's `not_available` list when it bears on the story. |

Rules of resolution:
- `covered` requires the sidecar to carry the packet references used.
- `not material` requires a reason ("no near-miss candidate above salience 0.4").
- `not available` requires naming the missing source (radio, stewards' reasoning, corner data).
- A beat resolved `covered` whose references fail the verifier fails the draft.
