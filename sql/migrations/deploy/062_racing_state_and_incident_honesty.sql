-- Deploy openf1:062_racing_state_and_incident_honesty to pg
-- requires: 061_analyst_corpus
--
-- Analyst probe honesty fixes (analyst/2026_1293/platform_gaps.md G3+G4):
--
-- G4 — analytics.race_control_incidents was STEWARDS-ONLY ("FIA STEWARDS:%"),
--   so track-limits lap deletions, race-director "NOTED" incidents and
--   black-and-white flags were invisible to incident queries (the product
--   said "no race control messages" about Antonelli's lap-49 deletion at
--   Monza 2026). The matview now covers every non-flag incident message and
--   carries source_kind. Existing columns are unchanged (appended columns
--   only) so the M15 card and the LLM contract keep working.
--
-- G3 — racing-state intervals as a FIRST-CLASS object. The product fabricated
--   the absence of a VSC ("zero disrupted laps", "no VSC recorded") because
--   VSC rows carry category='SafetyCar', flag=NULL and only the message text
--   "VSC DEPLOYED"; flag-based filters miss them. analytics.racing_state_intervals
--   materialises SC / VSC / RED periods per session with the exact temporal
--   contract of web/scripts/analyst/lib/packet.mjs:
--     * "VSC ENDING" is a warning and never closes; no session in this
--       warehouse carries "VSC ENDED", so the close is INFERRED at the end of
--       the ENDING lap (endpoint_inferred='ending_lap_end') unless a later
--       TRACK CLEAR / GREEN closes it explicitly;
--     * "RACE WILL RESUME AT" is an announcement and never closes a red;
--       "GREEN LIGHT - PIT EXIT OPEN" during a suspension never closes it;
--       a red closes on the resumption state message (SAFETY CAR LIGHTS ON /
--       SAFETY CAR DEPLOYED) or a green issued after the announcement;
--     * SC closes at the lap end of "SAFETY CAR IN THIS LAP" / "LIGHTS ON".
--   Inferred endpoints are flagged, never silent.

BEGIN;

-- ------------------------------------------------------------------ G4
-- analytics.driver_performance_score_data depends on the FACADE view, so the
-- view is never dropped: build the widened matview under a temporary name,
-- re-point the view (CREATE OR REPLACE — new columns are appended only), drop
-- the old matview, rename the new one to the canonical name.
CREATE MATERIALIZED VIEW analytics.race_control_incidents_data_v2 AS
WITH stewards AS (
  SELECT
    rc.id              AS race_control_id,
    rc.session_key,
    rc.meeting_key,
    rc.lap_number,
    rc.date,
    rc.message,
    UPPER(rc.message)  AS message_upper,
    CASE
      WHEN UPPER(rc.message) LIKE 'FIA STEWARDS:%'                                THEN 'stewards'
      WHEN UPPER(rc.message) LIKE '%DELETED%'                                     THEN 'deleted_lap'
      WHEN UPPER(rc.message) LIKE '%BLACK AND WHITE%'                             THEN 'black_white'
      ELSE 'race_director_note'
    END AS source_kind
  FROM raw.race_control rc
  WHERE rc.category IS DISTINCT FROM 'Flag'
    AND rc.category IS DISTINCT FROM 'SafetyCar'
    AND (
      UPPER(rc.message) LIKE 'FIA STEWARDS:%'
      OR UPPER(rc.message) LIKE '%DELETED%'
      OR UPPER(rc.message) LIKE '%BLACK AND WHITE%'
      OR UPPER(rc.message) LIKE '%INCIDENT%'
      OR UPPER(rc.message) LIKE '%PENALTY%'
      OR UPPER(rc.message) LIKE '%INVESTIGAT%'
    )
),
parsed AS (
  SELECT
    s.race_control_id,
    s.session_key,
    s.meeting_key,
    s.lap_number,
    s.date,
    s.message,
    s.message_upper,
    s.source_kind,
    -- driver_number: first number following "CAR " in the message.
    NULLIF(
      (regexp_match(s.message_upper, 'CAR\s+(\d+)'))[1],
      ''
    )::INTEGER AS driver_number,
    -- second driver if message references two cars.
    NULLIF(
      (regexp_match(s.message_upper, 'CARS\s+\d+\s*\([A-Z]+\)\s+AND\s+(\d+)'))[1],
      ''
    )::INTEGER AS second_driver_number,
    -- penalty_seconds: number preceding "SECOND TIME PENALTY".
    NULLIF(
      (regexp_match(s.message_upper, '(\d+)\s+SECOND\s+TIME\s+PENALTY'))[1],
      ''
    )::INTEGER AS penalty_seconds,
    -- action_status: classify the steward action.
    CASE
      WHEN s.message_upper LIKE '%TIME PENALTY%'                THEN 'time_penalty'
      WHEN s.message_upper LIKE '%DRIVE-THROUGH%'
        OR s.message_upper LIKE '%DRIVE THROUGH%'               THEN 'drive_through'
      WHEN s.message_upper LIKE '%REPRIMAND%'                   THEN 'reprimand'
      WHEN s.message_upper LIKE '%GRID PENALTY%'
        OR s.message_upper LIKE '%GRID DROP%'                   THEN 'grid_penalty'
      WHEN s.message_upper LIKE '%NO FURTHER ACTION%'
        OR s.message_upper LIKE '%NO FURTHER INVESTIGATION%'    THEN 'no_further_action'
      WHEN s.message_upper LIKE '%UNDER INVESTIGATION%'         THEN 'under_investigation'
      WHEN s.message_upper LIKE '%WILL BE INVESTIGATED%'        THEN 'investigation_deferred'
      ELSE 'other'
    END AS action_status,
    -- incident_kind: classify the incident reason.
    CASE
      WHEN s.message_upper LIKE '%TRACK LIMITS%'
        OR s.message_upper LIKE '%TRACK LIMIT %'                THEN 'track_limits'
      WHEN s.message_upper LIKE '%LEAVING THE TRACK AND GAINING%'
        OR s.message_upper LIKE '%LEAVING THE TRACK%'           THEN 'leaving_track_advantage'
      WHEN s.message_upper LIKE '%CAUSING A COLLISION%'
        OR s.message_upper LIKE '%COLLISION%'                   THEN 'collision'
      WHEN s.message_upper LIKE '%FORCING ANOTHER DRIVER%'      THEN 'forcing_off'
      WHEN s.message_upper LIKE '%UNSAFE RELEASE%'              THEN 'unsafe_release'
      WHEN s.message_upper LIKE '%SPEEDING IN THE PIT LANE%'    THEN 'pit_speeding'
      WHEN s.message_upper LIKE '%PIT LANE %'
        OR s.message_upper LIKE '%PIT ENTRY %'                  THEN 'pit_lane_infraction'
      WHEN s.message_upper LIKE '%FALSE START%'
        OR s.message_upper LIKE '%JUMPED START%'                THEN 'false_start'
      WHEN s.message_upper LIKE '%INCORRECT STARTING%'          THEN 'incorrect_grid_position'
      WHEN s.message_upper LIKE '%MULTIPLE TRACK LIMIT%'        THEN 'multiple_track_limits'
      WHEN s.message_upper LIKE '%NOT ENTERING PIT LANE%'       THEN 'not_entering_pit_lane'
      WHEN s.message_upper LIKE '%TYRES%'
        OR s.message_upper LIKE '%TYRE %'                       THEN 'tyre_compliance'
      ELSE 'other'
    END AS incident_kind
  FROM stewards s
)
SELECT
  p.race_control_id,
  p.session_key,
  p.meeting_key,
  p.lap_number,
  p.date,
  p.driver_number,
  p.second_driver_number,
  p.incident_kind,
  CASE
    WHEN p.message_upper LIKE '%DELETED%'          THEN 'lap_deleted'
    WHEN p.message_upper LIKE '%BLACK AND WHITE%'  THEN 'black_white_flag'
    WHEN p.action_status = 'other' AND p.message_upper LIKE '%NOTED%' THEN 'noted'
    ELSE p.action_status
  END AS action_status,
  p.penalty_seconds,
  NULL::INTEGER AS penalty_points,
  p.message      AS message_text,
  p.source_kind,
  NULLIF((regexp_match(p.message_upper, '\mLAP\s+(\d+)'))[1], '')::INTEGER AS occurred_lap
FROM parsed p;

CREATE OR REPLACE VIEW analytics.race_control_incidents AS
SELECT * FROM analytics.race_control_incidents_data_v2;

DROP MATERIALIZED VIEW IF EXISTS analytics.race_control_incidents_data;
ALTER MATERIALIZED VIEW analytics.race_control_incidents_data_v2 RENAME TO race_control_incidents_data;

CREATE INDEX IF NOT EXISTS race_control_incidents_data_session_idx
  ON analytics.race_control_incidents_data (session_key);
CREATE INDEX IF NOT EXISTS race_control_incidents_data_driver_idx
  ON analytics.race_control_incidents_data (session_key, driver_number);
CREATE INDEX IF NOT EXISTS race_control_incidents_data_kind_idx
  ON analytics.race_control_incidents_data (incident_kind);

COMMENT ON VIEW analytics.race_control_incidents IS
  'Race-control INCIDENT messages parsed from raw.race_control: FIA STEWARDS messages PLUS lap deletions (track limits), black-and-white flags and race-director NOTED/investigation notes (migration 062 widened the former stewards-only filter). Columns: driver_number, second_driver_number, incident_kind, action_status (time_penalty / lap_deleted / black_white_flag / noted / under_investigation / no_further_action / ...), penalty_seconds, source_kind (stewards / deleted_lap / black_white / race_director_note), occurred_lap (the lap the message cites, when it does — distinct from lap_number = when it was issued). penalty_points is always NULL (not in the feed). Flags, blue flags and SC/VSC state messages are NOT here — use analytics.racing_state_intervals for SC/VSC/red periods.';

-- ------------------------------------------------------------------ G3
CREATE OR REPLACE FUNCTION analytics.racing_state_intervals_fn(p_session_key BIGINT)
RETURNS TABLE (
  interval_no        INTEGER,
  kind               TEXT,
  start_ts           TIMESTAMPTZ,
  end_ts             TIMESTAMPTZ,
  start_lap          INTEGER,
  end_lap            INTEGER,
  laps_affected      INTEGER,
  duration_s         NUMERIC,
  endpoint_inferred  TEXT,
  opened_by_message  TEXT,
  closed_by_message  TEXT
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r RECORD;
  m TEXT;
  open_kind TEXT := NULL; open_start TIMESTAMPTZ; open_lap INTEGER; open_msg TEXT;
  pend_ts TIMESTAMPTZ := NULL; pend_lap INTEGER; pend_how TEXT; pend_msg TEXT;
  last_ann TIMESTAMPTZ := NULL;
  n INTEGER := 0;
  le TIMESTAMPTZ;
BEGIN
  FOR r IN SELECT rc.date, rc.lap_number, UPPER(COALESCE(rc.message,'')) AS mu, rc.message
           FROM raw.race_control rc WHERE rc.session_key = p_session_key ORDER BY rc.date, rc.id
  LOOP
    m := r.mu;
    -- announcements never close anything
    IF m LIKE '%WILL RESUME AT%' OR m LIKE '%WILL RESTART%' THEN last_ann := r.date; CONTINUE; END IF;

    IF m LIKE 'RED FLAG%' THEN
      IF open_kind IS NOT NULL THEN
        n := n + 1; interval_no := n; kind := open_kind; start_ts := open_start; end_ts := r.date; start_lap := open_lap; end_lap := r.lap_number;
        endpoint_inferred := 'superseded_by_red'; opened_by_message := open_msg; closed_by_message := r.message;
        laps_affected := GREATEST(1, COALESCE(end_lap,start_lap) - start_lap + 1); duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
        open_kind := NULL; pend_ts := NULL;
      END IF;
      open_kind := 'red'; open_start := r.date; open_lap := r.lap_number; open_msg := r.message; CONTINUE;
    END IF;

    IF (m LIKE 'VSC DEPLOYED%' OR m LIKE 'VIRTUAL SAFETY CAR DEPLOYED%') THEN
      IF open_kind IS NOT NULL AND open_kind <> 'vsc' THEN
        n := n + 1; interval_no := n; kind := open_kind; start_ts := open_start; end_ts := r.date; start_lap := open_lap; end_lap := r.lap_number;
        endpoint_inferred := CASE WHEN open_kind = 'red' THEN 'resumption_state_msg' ELSE 'superseded_by_vsc' END; opened_by_message := open_msg; closed_by_message := r.message;
        laps_affected := GREATEST(1, COALESCE(end_lap,start_lap) - start_lap + 1); duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
        open_kind := NULL; pend_ts := NULL;
      END IF;
      IF open_kind IS NULL THEN open_kind := 'vsc'; open_start := r.date; open_lap := r.lap_number; open_msg := r.message; END IF;
      CONTINUE;
    END IF;

    IF (m LIKE 'VSC ENDED%' OR m LIKE 'VIRTUAL SAFETY CAR ENDED%') AND open_kind = 'vsc' THEN
      n := n + 1; interval_no := n; kind := 'vsc'; start_ts := open_start; end_ts := r.date; start_lap := open_lap; end_lap := r.lap_number;
      endpoint_inferred := NULL; opened_by_message := open_msg; closed_by_message := r.message;
      laps_affected := GREATEST(1, COALESCE(end_lap,start_lap) - start_lap + 1); duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
      open_kind := NULL; pend_ts := NULL; CONTINUE;
    END IF;

    IF (m LIKE 'VSC ENDING%' OR m LIKE 'VIRTUAL SAFETY CAR ENDING%') AND open_kind = 'vsc' THEN
      SELECT MIN(l.date_start) INTO le FROM raw.laps l WHERE l.session_key = p_session_key AND l.lap_number = r.lap_number + 1;
      pend_ts := COALESCE(le, r.date); pend_lap := r.lap_number; pend_how := CASE WHEN le IS NULL THEN 'ending_msg_ts' ELSE 'ending_lap_end' END; pend_msg := r.message;
      CONTINUE;
    END IF;

    IF m LIKE 'SAFETY CAR DEPLOYED%' THEN
      IF open_kind IS NOT NULL AND open_kind <> 'sc' THEN
        n := n + 1; interval_no := n; kind := open_kind; start_ts := open_start; end_ts := r.date; start_lap := open_lap; end_lap := r.lap_number;
        endpoint_inferred := CASE WHEN open_kind = 'red' THEN 'resumption_state_msg' ELSE 'superseded_by_sc' END; opened_by_message := open_msg; closed_by_message := r.message;
        laps_affected := GREATEST(1, COALESCE(end_lap,start_lap) - start_lap + 1); duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
        open_kind := NULL; pend_ts := NULL;
      END IF;
      IF open_kind IS NULL THEN open_kind := 'sc'; open_start := r.date; open_lap := r.lap_number; open_msg := r.message; END IF;
      CONTINUE;
    END IF;

    IF m LIKE '%SAFETY CAR IN THIS LAP%' OR m LIKE 'SAFETY CAR LIGHTS ON%' THEN
      SELECT MIN(l.date_start) INTO le FROM raw.laps l WHERE l.session_key = p_session_key AND l.lap_number = r.lap_number + 1;
      IF open_kind = 'red' THEN
        n := n + 1; interval_no := n; kind := 'red'; start_ts := open_start; end_ts := r.date; start_lap := open_lap; end_lap := r.lap_number;
        endpoint_inferred := 'resumption_state_msg'; opened_by_message := open_msg; closed_by_message := r.message;
        laps_affected := GREATEST(1, COALESCE(end_lap,start_lap) - start_lap + 1); duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
        n := n + 1; interval_no := n; kind := 'sc'; start_ts := r.date; end_ts := COALESCE(le, r.date); start_lap := r.lap_number; end_lap := r.lap_number;
        endpoint_inferred := CASE WHEN le IS NULL THEN 'lights_on_msg_ts' ELSE 'lights_on_lap_end' END; opened_by_message := r.message; closed_by_message := r.message;
        laps_affected := 1; duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
        open_kind := NULL; pend_ts := NULL; CONTINUE;
      ELSIF open_kind = 'sc' THEN
        n := n + 1; interval_no := n; kind := 'sc'; start_ts := open_start; end_ts := COALESCE(le, r.date); start_lap := open_lap; end_lap := r.lap_number;
        endpoint_inferred := CASE WHEN le IS NULL THEN 'in_this_lap_msg_ts' ELSE 'in_this_lap_lap_end' END; opened_by_message := open_msg; closed_by_message := r.message;
        laps_affected := GREATEST(1, COALESCE(end_lap,start_lap) - start_lap + 1); duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
        open_kind := NULL; pend_ts := NULL; CONTINUE;
      END IF;
    END IF;

    IF (m LIKE 'GREEN LIGHT%' OR m LIKE 'TRACK CLEAR%') AND open_kind IS NOT NULL THEN
      IF open_kind = 'red' AND (m LIKE '%PIT EXIT%' OR last_ann IS NULL OR r.date < last_ann) THEN CONTINUE; END IF;
      n := n + 1; interval_no := n; kind := open_kind; start_ts := open_start; end_ts := r.date; start_lap := open_lap; end_lap := r.lap_number;
      endpoint_inferred := NULL; opened_by_message := open_msg; closed_by_message := r.message;
      laps_affected := GREATEST(1, COALESCE(end_lap,start_lap) - start_lap + 1); duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
      open_kind := NULL; pend_ts := NULL; CONTINUE;
    END IF;

    IF m LIKE 'CHEQUERED FLAG%' AND open_kind IS NOT NULL THEN
      n := n + 1; interval_no := n; kind := open_kind; start_ts := open_start; start_lap := open_lap; opened_by_message := open_msg;
      IF pend_ts IS NOT NULL THEN end_ts := pend_ts; end_lap := pend_lap; endpoint_inferred := pend_how; closed_by_message := pend_msg;
      ELSE end_ts := r.date; end_lap := r.lap_number; endpoint_inferred := 'unclosed_at_chequered'; closed_by_message := r.message; END IF;
      laps_affected := GREATEST(1, COALESCE(end_lap,start_lap) - start_lap + 1); duration_s := ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1); RETURN NEXT;
      open_kind := NULL; pend_ts := NULL;
    END IF;
  END LOOP;

  IF open_kind IS NOT NULL THEN
    n := n + 1; interval_no := n; kind := open_kind; start_ts := open_start; start_lap := open_lap; opened_by_message := open_msg;
    IF pend_ts IS NOT NULL THEN end_ts := pend_ts; end_lap := pend_lap; endpoint_inferred := pend_how; closed_by_message := pend_msg;
    ELSE end_ts := NULL; end_lap := NULL; endpoint_inferred := 'never_closed'; closed_by_message := NULL; END IF;
    laps_affected := CASE WHEN end_lap IS NULL THEN NULL ELSE GREATEST(1, end_lap - start_lap + 1) END;
    duration_s := CASE WHEN end_ts IS NULL THEN NULL ELSE ROUND(EXTRACT(EPOCH FROM (end_ts - start_ts))::numeric, 1) END; RETURN NEXT;
  END IF;
END;
$$;

CREATE MATERIALIZED VIEW analytics.racing_state_intervals_data AS
SELECT s.session_key, s.meeting_key, f.*
FROM raw.sessions s
CROSS JOIN LATERAL analytics.racing_state_intervals_fn(s.session_key) f
WHERE EXISTS (SELECT 1 FROM raw.race_control rc WHERE rc.session_key = s.session_key);

CREATE INDEX IF NOT EXISTS racing_state_intervals_data_session_idx
  ON analytics.racing_state_intervals_data (session_key);

CREATE OR REPLACE VIEW analytics.racing_state_intervals AS
SELECT * FROM analytics.racing_state_intervals_data;

COMMENT ON VIEW analytics.racing_state_intervals IS
  'SC / VSC / RED-FLAG periods per session derived from raw.race_control state messages (migration 062). One row per period: kind (sc|vsc|red), start_ts/end_ts, start_lap/end_lap, laps_affected, duration_s, endpoint_inferred (NULL when an explicit closing message exists; otherwise ending_lap_end / resumption_state_msg / lights_on_lap_end / in_this_lap_lap_end / superseded_by_* / unclosed_at_chequered / never_closed — this feed has no "VSC ENDED" messages, so VSC closes are inferred at the end of the ENDING lap), opened_by_message / closed_by_message. A session with race-control data and NO rows here genuinely had no SC/VSC/red periods. NEVER assert the absence of a safety car, VSC or red flag from flag columns or lap-time heuristics — query this view.';

COMMIT;
