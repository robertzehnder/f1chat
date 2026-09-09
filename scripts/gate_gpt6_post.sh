#!/usr/bin/env bash
# Gate for the GPT-6 Monza post (BRIEF.md). Runs from the repo root in a task
# worktree. Until analyst/2026_1293_gpt6 exists the checks are skipped so
# preparatory tasks (e.g. figures.mjs recipe loading) can merge; once it exists
# every step must pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
M="2026_1293_gpt6"
SLUG="monza-2026-gpt6"
DIR="$ROOT/analyst/$M"
if [ ! -d "$DIR" ]; then echo "gate: $DIR not present yet — skipping post checks"; exit 0; fi
cd "$ROOT/web"
for f in packet.json report.md sidecar.json post.md post.meta.json notes.md recipes.mjs; do
  [ -f "$DIR/$f" ] || { echo "gate: missing $DIR/$f"; exit 1; }
done
cmp -s "$DIR/packet.json" "$ROOT/analyst/2026_1293/packet.json" || { echo "gate: packet.json must be an unchanged copy of analyst/2026_1293/packet.json"; exit 1; }
words=$(sed '1d' "$DIR/report.md" | wc -w | tr -d ' ')
[ "$words" -ge 850 ] && [ "$words" -le 1500 ] || { echo "gate: report.md is $words words (want 900–1400)"; exit 1; }
node scripts/analyst/figures.mjs --meeting "$M" --verify
node scripts/analyst/verify_draft.mjs --dir "../analyst/$M"
node scripts/corpus/style_lint.mjs "$DIR/report.md"
node scripts/analyst/build_post.mjs --meeting "$M"
grep -q "\"slug\": \"$SLUG\"" "content/blog/$SLUG.json" || { echo "gate: content/blog/$SLUG.json missing or wrong slug"; exit 1; }
n=$(ls "public/blog/$SLUG"/*.png 2>/dev/null | wc -l | tr -d ' ')
[ "$n" -ge 3 ] || { echo "gate: expected ≥3 exported PNGs in public/blog/$SLUG (found $n) — run export_figures.mjs --slug $SLUG --base http://localhost:3101"; exit 1; }
# the existing post must be untouched
git -C "$ROOT" diff --quiet main -- analyst/2026_1293 web/content/blog/monza-2026.json web/public/blog/monza-2026 || { echo "gate: files under 'Do not touch' changed"; exit 1; }
echo "gate: gpt6 post checks passed ($words words, $n PNGs)"
