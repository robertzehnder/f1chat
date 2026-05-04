-- Deploy openf1:030_track_segments_corners to pg
-- requires: 029_track_segments_auto
--
-- Phase 20-B (slice 20-track-segments-corners): bolt FIA corner zones
-- onto f1.track_segments. Adds a small reference set of named-corner
-- entries per circuit, keyed by circuit_short_name and segment_kind =
-- 'corner'. The set is deliberately curated (not auto-derived) so
-- corner numbers and named labels match FIA programme docs and
-- broadcast graphics (e.g. "Turn 9 (Copse)" at Silverstone).
--
-- Coverage approach: ship the most-asked-about named corners for the
-- 2025 venues that have analyst coverage (per Phase 19 question
-- bank). Other circuits' corners are added by follow-up slices as the
-- analytics matviews extend their coverage. 21-corner-analysis depends
-- on this seed.

BEGIN;

-- One INSERT per (circuit, corner). Idempotent via ON CONFLICT.
INSERT INTO f1.track_segments (
  circuit_short_name, segment_kind, segment_index, segment_label,
  start_normalized, end_normalized, notes
) VALUES
  -- Silverstone (race start at Abbey, Copse is T9)
  ('Silverstone', 'corner',  1, 'Turn 1 (Abbey)',                  0.020, 0.040, 'Phase 20-B FIA corner seed'),
  ('Silverstone', 'corner',  9, 'Turn 9 (Copse)',                  0.330, 0.350, 'high-speed entry, Sky F1 SkyPad headline corner'),
  ('Silverstone', 'corner', 10, 'Turn 10 (Maggotts)',              0.355, 0.370, 'Sector 2 esses entry'),
  ('Silverstone', 'corner', 11, 'Turn 11 (Becketts)',              0.371, 0.390, 'Sector 2 esses mid'),
  ('Silverstone', 'corner', 12, 'Turn 12 (Chapel)',                0.391, 0.410, 'Sector 2 esses exit'),
  ('Silverstone', 'corner', 18, 'Turn 18 (Club)',                  0.880, 0.910, 'final corner — exit-traction critical'),
  -- Spa-Francorchamps
  ('Spa-Francorchamps', 'corner',  3, 'Eau Rouge',                  0.080, 0.105, 'Sector 1 high-speed compression'),
  ('Spa-Francorchamps', 'corner',  4, 'Raidillon',                  0.106, 0.130, 'Sector 1 esses crest'),
  ('Spa-Francorchamps', 'corner', 11, 'Pouhon',                    0.420, 0.450, 'Sector 2 high-speed left'),
  ('Spa-Francorchamps', 'corner', 14, 'Stavelot',                  0.620, 0.650, 'Sector 3 high-speed right'),
  -- Monza
  ('Monza', 'corner',  1, 'Turn 1 (Rettifilo)',                     0.060, 0.090, 'heavy-braking chicane; speed-trap before'),
  ('Monza', 'corner',  6, 'Turn 6 (Lesmo 1)',                       0.330, 0.360, 'high-speed right'),
  ('Monza', 'corner',  7, 'Turn 7 (Lesmo 2)',                       0.361, 0.390, 'high-speed right'),
  ('Monza', 'corner',  8, 'Turn 8 (Ascari)',                        0.640, 0.690, 'medium-high speed chicane'),
  ('Monza', 'corner', 11, 'Turn 11 (Parabolica)',                   0.880, 0.940, 'long-radius right onto main straight'),
  -- Suzuka
  ('Suzuka', 'corner',  1, 'Turn 1',                                 0.040, 0.060, 'high-speed right'),
  ('Suzuka', 'corner',  2, 'Turn 2',                                 0.061, 0.080, 'paired with T1; downhill exit'),
  ('Suzuka', 'corner',  7, 'Turn 7 (Esses)',                         0.180, 0.220, 'Sector 2 esses entry — pace-defining'),
  ('Suzuka', 'corner',  8, 'Turn 8 (Degner 1)',                      0.300, 0.330, 'medium-radius right; exit traction critical'),
  ('Suzuka', 'corner',  9, 'Turn 9 (Degner 2)',                      0.331, 0.360, 'tighter than D1; trail-brake test'),
  ('Suzuka', 'corner', 11, '130R',                                   0.620, 0.650, 'flat-out high-speed left in 2025'),
  ('Suzuka', 'corner', 16, 'Casio Triangle (chicane)',               0.880, 0.920, 'final braking zone — overtaking spot'),
  -- Monaco
  ('Monaco', 'corner',  1, 'Turn 1 (Sainte Devote)',                 0.040, 0.075, 'race-start braking, narrow entry'),
  ('Monaco', 'corner',  4, 'Turn 4 (Massenet)',                      0.190, 0.220, 'left-hand sweep up to Casino'),
  ('Monaco', 'corner',  6, 'Turn 6 (Casino)',                        0.221, 0.260, 'crested-blind right; Q3 differentiator'),
  ('Monaco', 'corner', 10, 'Turn 10 (Loews / Hairpin)',              0.420, 0.460, 'slowest corner on calendar'),
  ('Monaco', 'corner', 13, 'Turn 13 (Tabac)',                        0.580, 0.610, 'rapid left-hand sweep'),
  ('Monaco', 'corner', 18, 'Turn 18 (Rascasse)',                     0.840, 0.870, 'tight 90-degree right, final-sector entry'),
  -- Hungaroring
  ('Hungaroring', 'corner',  1, 'Turn 1',                             0.030, 0.070, 'medium-speed right; pole launch'),
  ('Hungaroring', 'corner',  4, 'Turn 4',                             0.180, 0.220, 'tyre-sensitive on exit per OverTake'),
  ('Hungaroring', 'corner', 11, 'Turn 11',                            0.510, 0.540, 'slow chicane mid-lap'),
  ('Hungaroring', 'corner', 13, 'Turn 13',                            0.620, 0.660, 'patience-on-power final-sector approach'),
  ('Hungaroring', 'corner', 14, 'Turn 14',                            0.870, 0.910, 'final corner onto pit straight'),
  -- Bahrain
  ('Sakhir', 'corner',  1, 'Turn 1',                                  0.030, 0.060, 'heavy-braking chicane, race-start zone'),
  ('Sakhir', 'corner',  8, 'Turn 8',                                  0.380, 0.430, 'long-radius left — minimum-speed analysis canon'),
  ('Sakhir', 'corner', 10, 'Turn 10',                                 0.500, 0.540, 'medium-speed right'),
  -- Abu Dhabi (Yas Marina)
  ('Yas Marina', 'corner',  6, 'Turn 6',                              0.230, 0.260, 'first-sector hairpin'),
  ('Yas Marina', 'corner',  9, 'Turn 9',                              0.380, 0.410, 'long left'),
  -- Imola
  ('Imola', 'corner',  3, 'Turn 3 (Tamburello)',                      0.130, 0.165, 'rear-limited entry; Ferrari weakness 2025'),
  ('Imola', 'corner',  5, 'Turn 5 (Variante Villeneuve)',             0.220, 0.260, 'chicane critical on entry per Leclerc radio'),
  ('Imola', 'corner',  9, 'Turn 9 (Acque Minerali)',                  0.460, 0.500, 'rear-limited exit; Leclerc-Piastri loss zone'),
  ('Imola', 'corner', 11, 'Turn 11 (Variante Alta)',                  0.580, 0.620, 'critical entry per Leclerc team radio'),
  -- Saudi Arabia (Jeddah)
  ('Jeddah', 'corner',  1, 'Turn 1',                                  0.030, 0.060, 'heavy-braking chicane (Hamilton 2025 adaptation)'),
  ('Jeddah', 'corner', 22, 'Turn 22',                                 0.880, 0.920, 'late-corner mid-speed — Hughes Saudi long-runs piece')
ON CONFLICT (circuit_short_name, segment_kind, segment_index) DO UPDATE
SET segment_label    = EXCLUDED.segment_label,
    start_normalized = EXCLUDED.start_normalized,
    end_normalized   = EXCLUDED.end_normalized,
    notes            = EXCLUDED.notes;

COMMIT;
