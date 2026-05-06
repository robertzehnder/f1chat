// Per-file fixtures — re-exported as { allMocks: { m01: ..., ... } } for /mock.
// Each fixture lives in its own file (m01-hero.ts ... m22-pit-cycle-event.ts);
// they all re-export from _source.ts (the v0 mock-insights.ts monolith with
// import path rewritten to "@/lib/chart-types").
//
// 21 in-scope mocks. M07 (team-grouped ranking) and M23 (track marker map)
// are FOLLOW-UP — their renderers don't exist in v0's ChartRenderer switch.

import { m01 } from "./m01-hero";
import { m02 } from "./m02-yes-no";
import { m03 } from "./m03-metric-grid";
import { m04 } from "./m04-corner-grouped-bar";
import { m05 } from "./m05-braking-grouped-bar";
import { m06 } from "./m06-ranking-bar";
import { m08 } from "./m08-stint-gantt";
import { m09 } from "./m09-multi-line";
import { m10 } from "./m10-line-stint-markers";
import { m11 } from "./m11-scatter-regression";
import { m12 } from "./m12-diverging-bar";
import { m13 } from "./m13-stacked-horizontal";
import { m14 } from "./m14-dual-axis-line";
import { m15 } from "./m15-event-timeline";
import { m16 } from "./m16-minisector-heatmap";
import { m17 } from "./m17-radar";
import { m18 } from "./m18-status-grid";
import { m19 } from "./m19-donut";
import { m20 } from "./m20-cross-cat-composite";
import { m21 } from "./m21-no-data-refusal";
import { m22 } from "./m22-pit-cycle-event";

export const allMocks = {
  m01,
  m02,
  m03,
  m04,
  m05,
  m06,
  m08,
  m09,
  m10,
  m11,
  m12,
  m13,
  m14,
  m15,
  m16,
  m17,
  m18,
  m19,
  m20,
  m21,
  m22
};
