# Phrasing humanisation — converged plan (2026-09-08)

**Status: CONVERGED (SHIP) — 4-pass GPT-5.6 Sol review, findings 5 → 6 → 5 → 0, each pass checked against analyst/2026_1293/packet.json.**
Question: how to make the owner-structured report (highlights → lead-in →
analysis → winners & losers → close) sound human at the phrase level without
weakening a single hedge. Method distilled to corpus/style/phrasing_method.md;
demonstration = analyst/2026_1293/report.md (v7). The review's most valuable
catches were factual, not stylistic: an "in the mirrors" claim contradicting
the piece's own 40-laps-led figure, a tyre age wrong since v2, and a
half-second "pace" claim that was actually the gap.

### A. Diagnosis — three buckets, not one

**Bucket 1 — inherited prose defects (in v2 too; v2 still scored 81%, so these did not cause the v3 drop; still worth fixing):** balanced antitheses ("necessary … sufficient"), aphoristic paragraph buttons ("that was the race"), method-speak for honesty ("estimate rather than a measured counterfactual", "on this evidence", "labelled as one"), near-zero contractions, essay-style declarative section headings.

**Bucket 2 — v3-specific regressions (the leading explanation for 81% → 34%; simultaneous changes and judge noise mean it is not established as the sole cause):** a generic social-video greeting ("Hi friends. What a weekend … Let's dive in"), a section literally headed "Sign-off" that restates the standings, and headings that announce the structure. None of the five distilled registers greets; F1 Debrief (the newsletter in the corpus) opens on a specific declarative hook and closes forward-looking — so a lead-in and a close ARE corpus-supported; a generic greeting and a labelled wrap-up are not.

**Bucket 3 — penalties mechanically caused by the mandated structure:** the judge's S2 (no wrap-up) and R1 (interpret, don't narrate) were distilled from writers who neither open with scene-setting nor close. With a lead-in and a close present, S2 has scored 0 and S1/S3/R1 have scored 1 across v3–v6 while register moved 2→8 — which APPEARS to cap the structure dimension independent of phrasing. This is a judge-register mismatch HYPOTHESIS to test under E, not an excuse.

### B. The phrasing method — principles with a naturalness test, no quotas
Each principle carries the test "would a working analyst write this sentence unprompted?" and a "where it arises naturally" clause. Nothing is mandated per section.
1. **Contractions by default** in narrative sentences; none inside quoted record.
2. **Open on the reader's actual experience of THIS race and the one thing they missed** — specific, not warm-up. v5: "If you only caught the last three laps on Sunday, you saw the pass. What you didn't see is why it was ever close, and the answer starts on lap 3."
3. **Say the uncertainty once, in plain speech, where the number first appears** — never a second defensive flag. v5: "about 31 seconds, going by the race's median pit-lane time." (v4 had "Call it an estimate, because it is" + "I'd rather say so than pretend otherwise" — both cut.)
4. **Prefer a plain observation to an antithesis or a button.** "The pace was real. The cheap stop is what let him spend it." is kept because it carries information; "that was the race" is gone.
5. **A question is fine when the writer would actually ask it and can answer it in a breath**; never inserted for texture. v5 keeps two ("Would he have won anyway? I don't think so."; "Should he have pitted under the VSC too?").
6. **First person only for a judgment the data leaves open** (one owned "I don't think so"); no self-reference to the piece.
7. **No manufactured personality tokens**: no "apparently", "whatever you heard", "keep everyone honest", "I'm not going to guess". Dry understatement is allowed only when it IS the observation ("Half a second a lap quicker wasn't enough to get past at Monza.").
8. **No proposition without a source**: every claim about what people thought, knew, or felt is out unless attributed. (This is where v4 failed — and where the honesty line actually lives at the phrase level.)
9. **Fragments and short sentences at the decisive moment**, because that is how the moment reads, not as a device: "Then lap 49." / "Lap 50, he was through. Three laps to run."
10. **Verdict list in the pros' label form** ("**Winner: Antonelli (1st).**"), two sentences each.
11. **One exact figure where it clinches; human quantifiers elsewhere** ("40-odd laps old"); no re-running the arithmetic in the counterfactual section.
12. **Close forward-looking and specific, with no restatement of the argument**: v5 "Madrid next: a new circuit, so no prior-year data to lean on. See you Sunday." — the heading is no longer "Sign-off".

### C. Demonstration, measured (all pass verifier / linter / similarity guard)
| | v2 | v3 | v4 | v5 |
|---|---|---|---|---|
| judge total (runs) | 25 | 18 | 22, 21 | 22, 21 |
| human-likelihood | 81 | 34 | 74, 72 | 72, 62 |
| register (of 8) | 5 | 2 | 7 | 8, 7 |
| structure (of 6) | 5 | 2 | 2 | 2 |
| blind LLM detector | pro detected (4) | pro detected (4) | pro detected (4) | "detected" (4) — but its stated tells called the PRO's idioms ("imperious, incisive", "sky is falling down") AI-like and our dry precision "authentically human"; its JSON pick and its reasoning disagreed |
Honest reading: run-to-run noise on this judge is ±1 point and ±10 on human-likelihood, so v4→v5 is "no worse" not "better"; register moved from 2 to 7–8 with the structure fixed at 2 — consistent with Bucket 3, not proof of it. The LLM detector is not yet a usable signal: its reasoning contradicted its own pick on v5, and it labels real columnist idiom as AI. It needs calibration against blinded owner votes before it counts for anything.

### D. Systemic changes (proportionate for one developer)
1. **Linter v2 = one hard list + advisory diagnostics.** Hard (gate): stock greeting/close phrases ("Hi friends", "What a weekend", "Let's dive in", "buckle up", "that's a wrap", a heading literally named Sign-off/Wrap-up). Advisory (reported, never gating): contraction rate, first-person rate, antithesis frames, method-speak phrases, short paragraph-closing sentences, repeated hedging of the same figure. A diagnostic becomes a gate only after the owner has rejected that pattern in blinded review on ≥3 separate pieces.
2. **Voice pass with semantic claim protection.** Before the pass, the sidecar's claims are expanded to protected SPANS in the draft (the full sentence carrying each claim, including its qualifier, uncertainty marker, attribution and causal connective). The pass may edit only unprotected sentences and may not delete a protected span; protected spans may be re-worded ONLY via a second, claim-by-claim step where the reviewer sees old/new side by side with the packet reference. After the pass: (a) the verifier re-runs; (b) a **new-proposition check** — an LLM lists every factual proposition in the edited draft that is absent from the pre-edit draft; the LLM PROPOSES a classification — voice-only (no factual content), supported (maps to a packet path or attribution → added to the sidecar), or unsupported — and the reviewer CONFIRMS every proposition that is not trivially voice-only; an unsupported proposition rejects the pass. Whole-sentence protection is deliberately conservative; the reviewed claim-by-claim step is what keeps protected sentences editable. This is the check that would have caught "in the mirrors", "nobody thought much of it", and "neither did he".
3. **Register-aware judge, corpus-first, gated on evidence.** Do not hand-edit the rubric. Add the newsletter/spoken-intro register to the corpus (F1 Debrief is there; Palmer's and The Race video transcripts are there — extract OPENINGS and CLOSES as a dimension), re-distill a newsletter dimension doc, and generate a second judge mode from it. It is operationalised ONLY if the three-race calibration (D5) shows useful agreement with blinded owner preference; otherwise it stays an experiment.
4. **Learn from the owner's line edits — as candidates, not rules.** One hand-edited piece per race; each diff yields candidate patterns; a candidate becomes advisory after 2 races and a gate only per D1. Three races collect examples, they do not derive rules.
5. **Evaluation protocol — a FIXED three-race calibration exercise, not a per-piece programme.** For the next three races: one anonymised blind pair per piece scored blind by the owner (the arbiter), the judge run once per mode, the LLM detector once. Output: agreement rates of judge and detector against blinded owner preference, by dimension. After that exercise the ongoing per-piece cost is one owner vote and one judge run; the second judge mode and the detector are kept only if they earned agreement. Claims like "recovered the register loss" are made only from this data.

### E. What is NOT proposed
No fine-tuning; no weakening of any hedge (only its phrasing); no removal of the owner's structure; no invented quotes; no personality quotas.

---

## Review log (GPT-5.6 Sol, 4 passes, 2026-09-08)
- **Pass 1 (REVISE, 5):** diagnosis conflated inherited defects with the v3
  regression (v2 had the same buttons and scored 81%); v4 over-humanised with
  personality tokens and UNSUPPORTED propositions, one factually wrong; linter
  quotas measure surface mimicry and invite gaming; byte-identical numbers ≠
  preserved meaning; two judge runs are not evidence; "owner votes win" vs
  "blind pairs arbiter" reconciled.
- **Pass 2 (REVISE, 6 textual + proportionality):** contradiction ("before
  anyone had done a racing lap" vs seven places in two laps); "back up the
  crowd" texture; "looked like a routine split" still a perception claim;
  counterfactual too categorical in three places; "no say in" overstated;
  Verstappen sentence ambiguous; D3/D5 too costly → fixed three-race
  calibration; LLM proposes, reviewer confirms.
- **Pass 3 (REVISE, 5 textual):** "last three laps" (pass on lap 50 of 53);
  tyre age 24 → 22; "half a second a lap quicker" false; Gasly categorical;
  "quickest car on the day" too broad.
- **Pass 4 (SHIP):** all five fixed, no regression.
