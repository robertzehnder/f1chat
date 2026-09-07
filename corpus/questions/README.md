# Per-race fan-question notes (Reddit substitute)

Reddit automation is **prohibited** in the rights registry (user decision
2026-09-06). Instead, after each race, skim the r/formula1 post-race thread
and r/F1Technical race thread YOURSELF and jot the top ~10 questions fans
were asking, in YOUR OWN WORDS — facts about audience curiosity, no stored
user content, no quotes, no usernames.

One file per race: `<season>_<meeting_key>.md`, e.g. `2026_1293.md`.

Format:

```markdown
# 2026 Italian GP (Monza) — fan questions

- Why did <team> pit <driver> so early when track position mattered?
- Was <driver>'s pace real or fuel-corrected illusion?
- ...
```

These feed the editorial agent's story selection (agent roster, plan doc).
The corpus pipeline treats them as doc_type `question_notes` if ever ingested
via the inbox (source_key `reddit` remains prohibited for automation — these
notes are YOUR authored content, not Reddit content).
