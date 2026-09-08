# Phrasing method — making a report sound human without lying (v1, 2026-09-08)

*Companion to composite_voice_v1.md (register) and content_contract.md (beats).
This is the SENTENCE-level layer. Converged through a 4-pass GPT-5.6 Sol review
on the Monza 2026 report (v3 → v7). Structure is the owner's: highlights →
lead-in → analysis → winners & losers → close.*

## The test every rule carries
**Would a working analyst write this sentence unprompted?** and **does it
survive the packet?** A sentence that adds personality but not information,
or adds information the packet doesn't hold, is out. There are no quotas: a
question, an aside or a first-person call appears where it arises, never
per section. Quotas produce an audible template within a few pieces.

## Three buckets when a piece "sounds machine"
1. **Inherited prose defects** (present in good-scoring drafts too): balanced
   antitheses ("necessary … sufficient"), aphoristic paragraph buttons ("that
   was the race"), method-speak for honesty ("estimate rather than a measured
   counterfactual", "on this evidence", "labelled as one"), no contractions,
   essay-style declarative headings. Worth fixing; rarely the cause of a drop.
2. **Regressions specific to the draft**: generic social-video greetings
   ("Hi friends. What a weekend … Let's dive in"), a section headed "Sign-off"
   that restates the standings, headings that announce the structure. The
   leading explanation for the v3 drop (81% → 34%). None of the five distilled
   registers greets; F1 Debrief opens on a specific hook and closes
   forward-looking, so a lead-in and a close are corpus-supported — a generic
   greeting and a labelled wrap-up are not.
3. **Penalties caused by the mandated structure**: the judge's no-wrap-up and
   interpret-don't-narrate rules come from writers who neither open with
   scene-setting nor close. A hypothesis under test (three-race calibration),
   not an excuse.

## Principles (each with the Monza before → after)
1. **Contractions by default** in narrative; none inside quoted record.
   "He had qualified seventh" → "He'd qualified seventh".
2. **Open on the reader's actual experience of THIS race and the one thing
   they missed.** "Hi friends. What a weekend…" → "If you only caught the
   last four laps on Sunday, you saw the pass. What you didn't see is why it
   was ever close, and the answer starts on lap 3."
3. **State uncertainty once, in plain speech, where the number first appears.**
   Never a second defensive flag. "an estimate rather than a measured
   counterfactual … labelled as one" → "about 31 seconds, going by the race's
   median pit-lane time."  ("Call it an estimate, because it is" + "I'd rather
   say so than pretend otherwise" were BOTH cut in review — defensive
   transparency reads as machine.)
4. **Prefer a plain observation to an antithesis or a button.** Keep a short
   sentence only if it carries information. "Nobody could see it yet, but that
   was the race" → "It was a conventional tyre split. It set up the rest of
   the afternoon."
5. **A question only when the writer would actually ask it and can answer it
   in a breath.** "Would he have won anyway? I don't think so."
6. **First person only for a judgment the data leaves open.** No reference to
   "this piece".
7. **No manufactured personality tokens.** Cut in review: "apparently",
   "whatever you heard", "which should keep everyone honest", "I'm not going to
   guess", "Neither, I suspect, did he at the time". Dry understatement is
   allowed only when it IS the observation: "Closing wasn't passing, not at
   Monza."
8. **No proposition without a source — the honesty line lives here at the
   phrase level.** Claims about what people thought, knew or felt are out
   unless attributed. Review caught, in one draft: "with his team-mate in the
   mirrors for most of them" (false — Russell led 40 laps; Antonelli was
   chasing), "Nobody thought much of it at the time" (reaction claim),
   "Neither did he" (Russell's knowledge). A number-only verifier cannot see
   these; the new-proposition check (below) exists for them.
9. **Fragments at the decisive moment because that is how it reads, not as a
   device.** "Then lap 49." / "Lap 50, he was through. Three laps to run."
10. **Verdict list in the pros' label form**, two sentences each:
    "**Winner: Antonelli (1st).**"
11. **One exact figure where it clinches; human quantifiers elsewhere**
    ("40-odd laps old"); never re-run the arithmetic in the counterfactual
    section. Qualify extrapolations as such: "On that simple extrapolation
    Russell keeps the lead."
12. **Close forward-looking and specific, no restatement of the argument, and
    don't call it a sign-off.** "Madrid next: a new circuit, so no prior-year
    data to lean on. See you Sunday."

## Precision traps found in review (all against packet.json)
- "the last three laps" when the pass was on lap 50 of 53 → "last four laps".
- "24-lap-old tyres" at lap 26 → 22 (24 is lap 28). Had survived three versions.
- "Half a second a lap quicker" — the half-second was the GAP; the closing rate
  over laps 26–28 was ~0.14 s/lap → "took about a tenth a lap out of that".
- "lost the race to a timing he had no say in" → the VSC timing was outside
  his control; the pit call was not → "a VSC he couldn't time and a pit call
  that went the other way".
- "The car drifted back to where its race pace put it" (car-vs-tyre not
  separable) → "The trace shows a steady drift back rather than an incident."
- "quickest car on the day" → "quicker car late on" (what laps 40–48 support).

## Systemic follow-ups (see diagnostic/phrasing_humanization_plan_2026-09-08.md)
Linter v2 (hard stock-phrase list + advisory diagnostics, gates only after
repeated blinded owner rejection); voice pass with semantic claim protection
and a reviewer-confirmed new-proposition check; register-aware judge only if a
three-race calibration earns it; blinded owner preference as the arbiter.

---

## v2 addendum — the narrative article register (owner decision, 2026-09-08)

The owner chose the flowing article over the jump-cut columnist shape ("it
sounded way better; it was too jarring before"). Corpus-first response: Mark
Hughes' 2025 race pieces were added (22 dev-split exemplars), a `narrative`
distillation profile produced `corpus/style/composite_voice_v2_narrative.md`,
and the style judge gained `--mode narrative` with rules distilled from that
register. Principles 1–12 above still apply at the sentence level; these
override where they conflict:

- **Open on the result and the hinge, in the first two paragraphs.** No
  greeting, no highlights block, no scene-setting: "Antonelli started 19th and
  finished an Italian Grand Prix winner. But the comeback … hinged on a
  decision made while the cars were standing still."
- **Sections hand off; transitions carry information.** Chronology is the
  spine and the analysis rides on it. A one-sentence pivot paragraph marks a
  turning point ("The race turned on lap 28.").
- **Restrained third person.** Findings are stated as findings; first person
  is rarer than in the columnist register and used only for a judgment the
  data leaves open. The reader is trusted, not addressed.
- **Caveats folded mid-sentence, once.** "…would have cost roughly 31, going
  by the race's median pit-lane time." Never an isolated apparatus sentence.
- **Record and quotes respond to claims already made** — parenthetical, in
  flow — never as section-leading punctuation.
- **Questions only at genuine pivots.** The narrative judge docked a soft
  mid-flow question ("The question was whether…"); a declarative carried it.
- **The rest of the field as connected closing paragraphs**, a sentence or
  two per team, in descending relevance — not a labelled winners/losers list.
- **Close forward-leaning and syntactically open**, never a recap. The judge
  docked a triadic checklist ("recovered the positions, made the tyres work,
  completed the pass"); the replacement leans into Madrid's unknowns.
- **Honesty rules are unchanged.** The Astra draft the owner liked still
  needed five fixes before it passed: the VSC cause attributed, observed 13 s
  distinguished from the estimated 31 s, two perception/crowd claims removed,
  the counterfactual named as an extrapolation, and the stewards' record
  woven in. Flow and honesty are not in tension; flow and *apparatus* were.

Measured (narrative-mode judge): v8 25/28, Astra 24, v2 23, v7 16 — the
register the owner prefers now has a judge that scores it fairly, and the
honesty edits improved the piece rather than costing it.
