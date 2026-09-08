# Monza 2026 — our recap vs. what the writers published

*Comparison run 2026-09-07 after refreshing the corpus (two new Race pieces landed
Monday). Sources: The Race "Winners and losers" (race day) and "Everything we
learned" (Mon), Edd Straw's rankings (Mon), Formula1.com race report, Sky Sports
race report, FIA race report, F1 Debrief (quali-led). Ours:
diagnostic/monza_2026_recap_pilot.md.*

## 1. Verdict up front

Our recap got every **number** right and the **story** wrong. All seven outside
pieces agree on the mechanism of the win — a mid-race Virtual Safety Car
(Stroll's hydraulics, lap 28) handed Antonelli, a medium-tyre runner, a free stop
for fresh mediums while Russell, on hards since the restart, stayed out on rubber
that was 50 laps old by the flag. Our recap does not contain the words "virtual
safety car". It called the lap-28 stop "his green-flag pit stop" and attributed
the win to "pure pace". **Our own warehouse had the mechanism the whole time**:
`raw.race_control` says "VSC DEPLOYED" on lap 28, `raw.stints` shows ANT
MEDIUM→MEDIUM vs RUS HARD L4–53, and seven cars pitted on laps 27–28. I printed
the first 40 race-control rows, never queried stints, and never asked why seven
cars boxed together.

That is the whole lesson of this exercise: the platform supported the analysis;
the analyst (me) under-queried and then narrated a cause the data hadn't shown.

## 2. Three things our recap asserted that were wrong

| Our claim | What actually happened | How the pros knew | What our data said (unqueried or misread) |
|---|---|---|---|
| Won on "pure pace"; lap-28 stop was a routine green-flag stop | Won on a **tyre offset**: VSC free stop for fresh mediums vs Russell's ageing hards. Russell: "if either of us were to pit, it was going to be Kimi" | Broadcast + Russell's quote (The Race W/L) | `race_control` L28 "VSC DEPLOYED"; `stints` compounds; L27–28 pit cluster |
| L49 gap bounce (0.16→0.90s) = "Russell's one flash of resistance" | **Antonelli's error** — ran into the gravel at the first chicane on his first attempt ("caught out by the breaking-up track surface" — Straw) | Broadcast; Antonelli's quote on the tarmac breaking up | The interval trace showed the *effect*; I invented the *cause*. Location data (`raw.location`) could have shown the excursion |
| Pérez's 5s penalty was for "the start procedure" | Penalty (L30) was for a **Turn 1 incident on lap 25** ("failing to follow race director's instructions"); the *start*-related note was a separate L1 investigation | — (none of the reports mention Pérez at all) | `race_control` L25 "TURN 1 INCIDENT… CAR 11", L30 penalty — I conflated it with the L1 note |

None of the three is a data error. All three are **reading** errors: stopping the
query early, narrating a cause for a data feature, and joining two events by
theme rather than by timestamp.

## 3. What every pro covered that we didn't

- **The "from 12th, not 19th" caveat.** Antonelli gained seven places on the two
  laps before the red flag (P19→P12) and restarted 12th. The Race says this
  keeps the win "out of the pantheon" of front-to-back drives; Straw scores the
  seven places as a PRO. Our data had L2:P12 — we let "19th" stand unqualified.
- **The near-miss on lap 49** and the pass location (between Lesmo 2 and Ascari,
  lap 50). Every report has the corner. We had the lap, not the corner.
- **Gasly's race**: pole to 7th, 2.7s behind Hamilton, 18s ahead of Lindblad —
  absent from ours entirely despite being the weekend's second story.
- **Championship arithmetic**: Antonelli 66 points clear of Russell. Every piece
  states it; our results table gives ANT 267 / RUS 201 = 66 exactly. We had it
  and didn't say it.
- **Quotes as evidentiary full stops**: Russell on the VSC timing, Wolff's
  "AI agent" line, Antonelli's radio ("Do you want me just to sit behind, or
  what?"), Hamilton's "no rules", Verstappen's "rear axle" radio. We had zero
  quotes; race-control messages verbatim were the honest substitute we didn't use.
- **Historical framing**: first Italian winner at Monza since Scarfiotti 1966;
  second-lowest winning grid slot after Watson's 22nd in 1983 (Sky, FIA). We
  can compute lowest-grid wins for 2023–26 only; the 1966/1983 records are
  external — a `source-only` item, but the *framing move* is learnable.
- **The secondary storylines** the Race pieces carry: Stroll's VSC-triggering
  failure, Colapinto's restart cameo and Lesmo off, Lawson's black-and-white
  flag and Hülkenberg's "sketchy" verdict, Bearman missing the VSC window,
  Verstappen's post-stop battle with Piastri. Ours stopped at the top six.

## 4. What we had that the writers didn't

- **The exact gap collapse**: 3.86 → 2.61 → 1.48 → 0.77 → 0.16s over laps 44–48.
  The reports say "~10s after the VSC" / "15-second deficit" and then "closed in".
  Ours is the only account with the per-lap trace.
- **Fastest lap**: Antonelli 1:23.504, +0.74s clear of Verstappen's best. No report
  cites it.
- **The Pérez penalty** — in no outside report at all. Data-only.
- **Adjudicating the pros' disagreements.** They contradict each other on laps:
  Leclerc's crash is "lap 1" (FIA), "lap 2" (F1.com), "lap 3" (Sky); the VSC is
  "lap 26" (F1.com) / "lap 29" (Sky). Our warehouse settles it: Leclerc's last
  completed lap was 2, red flag lap 3, VSC deployed lap 28 (leader lap). Sky's
  "lap 55/57" for the final passes is impossible in a 53-lap race. **On lap
  numbers, the warehouse is more reliable than two of the three reports.**

## 5. Coverage matrix

| Moment | Race W/L | Race ETWL | Straw | F1.com | Sky | FIA | **Ours** |
|---|---|---|---|---|---|---|---|
| Leclerc crash → red flag | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ham–Lec first-chicane contact | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | hedged ✓ |
| Restart from 12th (7 places in 2 laps) | ✓ | – | ✓ | – | – | ✓ | data had it, unsaid |
| Antonelli to lead by L18 | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ |
| **VSC (Stroll) free stop, medium vs hard** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **✗** |
| L49 gravel near-miss | ✓ | – | ✓ | ✓ | ✓ | ✓ | misread |
| Pass at Lesmo 2/Ascari, L50 | ✓ | – | – | ✓ | ✓ | ✓ | lap only |
| Per-lap gap collapse L44–48 | – | – | – | – | – | – | **✓ unique** |
| Fastest lap | – | – | – | – | – | – | **✓ unique** |
| Gasly pole→7th | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✗ |
| 66-point lead | ✓ | ✓ | – | ✓ | ✓ | – | data had it, unsaid |
| Pérez 5s penalty | – | – | – | – | – | – | **✓ unique** (mis-timed) |
| Driver/team quotes | ✓✓ | ✓✓✓ | ✓ | ✓ | ✓ | – | none |

## 6. How each writer opened (the lead is the style)

- **F1.com / FIA / Sky**: the result, the grid position, the passing of Russell —
  one declarative sentence, then records (first Italian winner since 1966).
- **The Race W/L**: "stole the show" + a one-line inventory of the race's texture
  ("a big early crash, back-and-forths… the late hunt") before the entries.
- **The Race ETWL**: leads on **Ferrari**, not Antonelli — the editorial judgment
  that the home team's implosion is the more revealing story; Antonelli is
  section two.
- **Straw**: two sentences on the weekend's shape, then the modules.
- **Ours**: "and the number that explains it is the one nobody was looking at" —
  a rhetorical promise the piece never cashes (the number is never named), and
  the kind of hook the linter now bans.

## 7. What this changes for the writer agent

1. **Packet completeness is a gate, not a habit.** The critical-moments packet
   must ALWAYS include the full race-control log (every SC/VSC/red/penalty row,
   not the first 40), the stint/compound table for the top ten, and any pit
   cluster (≥3 cars within two laps) flagged with the race-control state at
   that moment. The VSC miss was a query-depth failure, and query depth can be
   enforced.
2. **Never narrate a cause the data didn't show.** A gap that re-opens is a fact;
   "Russell's flash of resistance" is fiction. The rule: an unexplained data
   feature is stated as a feature ("the gap opened again on lap 49") and, if a
   cause is wanted, it is either found in data (location trace, race control)
   or attributed to reporting. This becomes a verifier check: every causal
   clause needs a packet row or an attribution.
3. **Join events by timestamp, not by theme.** The Pérez conflation happened
   because two "car 11" messages looked related. Penalty rows carry lap numbers;
   the packet should pair each penalty with the incident row it cites.
4. **Always compute the three things every pro states**: restart-grid caveat,
   championship arithmetic, and the fate of the pole-sitter.
5. **Quote race control verbatim** where the pros quote radio — it is the one
   evidentiary voice we legitimately own.
6. **Our differentiator is real and should be leaned on**: the per-lap trace,
   the fastest lap, and lap-number adjudication when the reports disagree. The
   platform saw more than Sky did. It just needs an analyst who reads all of it.

## 8. Style-judge context

The judge scored The Race's own W/L piece 15/28 (52% "human") and ours 11/28
(14%); the LLM blind detector picked the pro at confidence 5. Reading the pieces
side by side, the gap is less about sentence craft than about **what the pros
knew**: quotes, the corner, the near-miss, the caveat. Most of that is
`source-only-reporting` — but the VSC, the restart grid, the fastest lap, and the
66 points were all in our data. Half the human-ness deficit was a query deficit.
