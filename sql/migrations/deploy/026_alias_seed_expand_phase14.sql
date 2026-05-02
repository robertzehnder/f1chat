-- Deploy openf1:026_alias_seed_expand_phase14 to pg
-- requires: 025_alias_view_diacritic_alignment
--
-- Phase 14-B/C/D: expanded alias seed coverage for casual fan phrasing.
-- The repo's f1_codex_helpers/*.csv files are gitignored scratch
-- workspace, so this migration is the committed source of truth for
-- the expanded coverage. INSERT ... ON CONFLICT DO NOTHING is keyed
-- on the partial-unique indexes restored by migration 025, so
-- re-deploys are safe and deduplicate against any rows already present
-- (e.g. from a CSV-loader run that already covers the row).
--
-- Coverage scope (best-effort breadth):
--   - Drivers: first/last/acronym/nickname for current 2024-2025 grid
--     and Hamilton/Russell/Tsunoda/Alonso/Norris/Piastri/Perez/Sainz
--     (incl. diacritic + nickname forms), Hulkenberg (incl. Hülkenberg),
--     Albon/Ocon/Gasly/Stroll/Bottas/Zhou/Magnussen/Sargeant/Lawson/
--     Bearman, plus Verstappen nicknames and Jos Verstappen for
--     historical disambiguation.
--   - Teams: 3-letter codes (RBR/MER/MCL/AST/ALP/WIL/HAS), casual
--     nicknames (energy drink, prancing horse, maranello, papaya,
--     silver arrows, green), full sponsorship names, AlphaTauri/Toro
--     Rosso/Racing Bulls lineage.
--   - Venues: country aliases for every existing venue, GP-name +
--     circuit-name + city aliases for missing venues, casual nicknames
--     (the Ardennes, the Tilkedrome). Diacritic forms (São Paulo,
--     Montréal) included alongside ASCII forms; Phase 14-E's
--     f1_unaccent normalization makes both resolve identically.
--
-- All inserted rows leave normalized_alias NULL — the partial-unique
-- index COALESCE fallback (`COALESCE(normalized_alias,
-- public.f1_unaccent(LOWER(BTRIM(alias_text))))` after migration 025)
-- handles uniqueness. The seed loader (scripts/load_codex_helpers.sh)
-- populates normalized_alias on its next UPDATE pass; until then the
-- views' inline f1_unaccent computations cover lookups.

BEGIN;

-- Drivers
INSERT INTO core.driver_alias_lookup (driver_number, canonical_full_name, first_name, last_name, name_acronym, broadcast_name, alias_text, alias_type) VALUES
  (1, 'Max Verstappen', NULL, NULL, 'VER', 'M VERSTAPPEN', 'super max', 'nickname'),
  (1, 'Max Verstappen', NULL, NULL, 'VER', 'M VERSTAPPEN', 'mad max', 'nickname'),
  (44, 'Lewis Hamilton', 'Lewis', 'Hamilton', 'HAM', 'L HAMILTON', 'lewis', 'first_name_alias'),
  (44, 'Lewis Hamilton', 'Lewis Hamilton', 'Hamilton', 'HAM', 'L HAMILTON', 'lewis hamilton', 'full_name_alias'),
  (44, 'Lewis Hamilton', NULL, NULL, 'HAM', 'L HAMILTON', 'ham', 'acronym_alias'),
  (63, 'George Russell', 'George', 'Russell', 'RUS', 'G RUSSELL', 'george', 'first_name_alias'),
  (63, 'George Russell', 'George Russell', 'Russell', 'RUS', 'G RUSSELL', 'george russell', 'full_name_alias'),
  (63, 'George Russell', NULL, NULL, 'RUS', 'G RUSSELL', 'rus', 'acronym_alias'),
  (63, 'George Russell', NULL, NULL, 'RUS', 'G RUSSELL', 'mr saturday', 'nickname'),
  (22, 'Yuki Tsunoda', 'Yuki', 'Tsunoda', 'TSU', 'Y TSUNODA', 'yuki', 'first_name_alias'),
  (22, 'Yuki Tsunoda', 'Yuki Tsunoda', 'Tsunoda', 'TSU', 'Y TSUNODA', 'yuki tsunoda', 'full_name_alias'),
  (22, 'Yuki Tsunoda', NULL, NULL, 'TSU', 'Y TSUNODA', 'tsu', 'acronym_alias'),
  (14, 'Fernando Alonso', 'Fernando', 'Alonso', 'ALO', 'F ALONSO', 'fernando', 'first_name_alias'),
  (14, 'Fernando Alonso', 'Fernando Alonso', 'Alonso', 'ALO', 'F ALONSO', 'fernando alonso', 'full_name_alias'),
  (14, 'Fernando Alonso', NULL, NULL, 'ALO', 'F ALONSO', 'alo', 'acronym_alias'),
  (14, 'Fernando Alonso', NULL, NULL, 'ALO', 'F ALONSO', 'magic alonso', 'nickname'),
  (14, 'Fernando Alonso', NULL, NULL, 'ALO', 'F ALONSO', 'nano', 'nickname'),
  (4, 'Lando Norris', NULL, 'Norris', 'NOR', 'L NORRIS', 'norris', 'last_name_alias'),
  (4, 'Lando Norris', NULL, NULL, 'NOR', 'L NORRIS', 'nor', 'acronym_alias'),
  (81, 'Oscar Piastri', NULL, NULL, 'PIA', 'O PIASTRI', 'pia', 'acronym_alias'),
  (81, 'Oscar Piastri', NULL, NULL, 'PIA', 'O PIASTRI', 'oscar piastri', 'full_name_alias'),
  (11, 'Sergio Perez', 'Sergio', 'Perez', 'PER', 'S PEREZ', 'sergio', 'first_name_alias'),
  (11, 'Sergio Perez', 'Sergio Perez', 'Perez', 'PER', 'S PEREZ', 'sergio perez', 'full_name_alias'),
  (11, 'Sergio Perez', 'Sergio', 'Pérez', 'PER', 'S PEREZ', 'perez', 'last_name_alias'),
  (11, 'Sergio Perez', NULL, NULL, 'PER', 'S PEREZ', 'pérez', 'last_name_alias'),
  (11, 'Sergio Perez', NULL, NULL, 'PER', 'S PEREZ', 'per', 'acronym_alias'),
  (11, 'Sergio Perez', NULL, NULL, 'PER', 'S PEREZ', 'checo', 'nickname'),
  (11, 'Sergio Perez', NULL, NULL, 'PER', 'S PEREZ', 'checo perez', 'nickname'),
  (55, 'Carlos Sainz', 'Carlos', 'Sainz', 'SAI', 'C SAINZ', 'carlos', 'first_name_alias'),
  (55, 'Carlos Sainz', 'Carlos Sainz', 'Sainz', 'SAI', 'C SAINZ', 'carlos sainz', 'full_name_alias'),
  (55, 'Carlos Sainz', 'Carlos Sainz Jr', 'Sainz', 'SAI', 'C SAINZ', 'carlos sainz jr', 'full_name_alias'),
  (55, 'Carlos Sainz', NULL, 'Sainz', 'SAI', 'C SAINZ', 'sainz', 'last_name_alias'),
  (55, 'Carlos Sainz', NULL, NULL, 'SAI', 'C SAINZ', 'sai', 'acronym_alias'),
  (55, 'Carlos Sainz', NULL, NULL, 'SAI', 'C SAINZ', 'smooth operator', 'nickname'),
  (27, 'Nico Hulkenberg', 'Nico', 'Hulkenberg', 'HUL', 'N HULKENBERG', 'nico', 'first_name_alias'),
  (27, 'Nico Hulkenberg', 'Nico Hulkenberg', 'Hulkenberg', 'HUL', 'N HULKENBERG', 'nico hulkenberg', 'full_name_alias'),
  (27, 'Nico Hulkenberg', 'Nico Hülkenberg', 'Hülkenberg', 'HUL', 'N HULKENBERG', 'hulkenberg', 'last_name_alias'),
  (27, 'Nico Hulkenberg', NULL, 'Hülkenberg', 'HUL', 'N HULKENBERG', 'hülkenberg', 'last_name_alias'),
  (27, 'Nico Hulkenberg', NULL, NULL, 'HUL', 'N HULKENBERG', 'hul', 'acronym_alias'),
  (27, 'Nico Hulkenberg', NULL, NULL, 'HUL', 'N HULKENBERG', 'hulk', 'nickname'),
  (23, 'Alex Albon', 'Alex', 'Albon', 'ALB', 'A ALBON', 'alex', 'first_name_alias'),
  (23, 'Alex Albon', 'Alex Albon', 'Albon', 'ALB', 'A ALBON', 'alex albon', 'full_name_alias'),
  (23, 'Alex Albon', 'Alexander Albon', 'Albon', 'ALB', 'A ALBON', 'alexander albon', 'full_name_alias'),
  (23, 'Alex Albon', NULL, 'Albon', 'ALB', 'A ALBON', 'albon', 'last_name_alias'),
  (23, 'Alex Albon', NULL, NULL, 'ALB', 'A ALBON', 'alb', 'acronym_alias'),
  (31, 'Esteban Ocon', 'Esteban', 'Ocon', 'OCO', 'E OCON', 'esteban', 'first_name_alias'),
  (31, 'Esteban Ocon', 'Esteban Ocon', 'Ocon', 'OCO', 'E OCON', 'esteban ocon', 'full_name_alias'),
  (31, 'Esteban Ocon', NULL, 'Ocon', 'OCO', 'E OCON', 'ocon', 'last_name_alias'),
  (31, 'Esteban Ocon', NULL, NULL, 'OCO', 'E OCON', 'oco', 'acronym_alias'),
  (10, 'Pierre Gasly', 'Pierre', 'Gasly', 'GAS', 'P GASLY', 'pierre', 'first_name_alias'),
  (10, 'Pierre Gasly', 'Pierre Gasly', 'Gasly', 'GAS', 'P GASLY', 'pierre gasly', 'full_name_alias'),
  (10, 'Pierre Gasly', NULL, 'Gasly', 'GAS', 'P GASLY', 'gasly', 'last_name_alias'),
  (10, 'Pierre Gasly', NULL, NULL, 'GAS', 'P GASLY', 'gas', 'acronym_alias'),
  (18, 'Lance Stroll', 'Lance', 'Stroll', 'STR', 'L STROLL', 'lance', 'first_name_alias'),
  (18, 'Lance Stroll', 'Lance Stroll', 'Stroll', 'STR', 'L STROLL', 'lance stroll', 'full_name_alias'),
  (18, 'Lance Stroll', NULL, 'Stroll', 'STR', 'L STROLL', 'stroll', 'last_name_alias'),
  (18, 'Lance Stroll', NULL, NULL, 'STR', 'L STROLL', 'str', 'acronym_alias'),
  (77, 'Valtteri Bottas', 'Valtteri', 'Bottas', 'BOT', 'V BOTTAS', 'valtteri', 'first_name_alias'),
  (77, 'Valtteri Bottas', 'Valtteri Bottas', 'Bottas', 'BOT', 'V BOTTAS', 'valtteri bottas', 'full_name_alias'),
  (77, 'Valtteri Bottas', NULL, 'Bottas', 'BOT', 'V BOTTAS', 'bottas', 'last_name_alias'),
  (77, 'Valtteri Bottas', NULL, NULL, 'BOT', 'V BOTTAS', 'bot', 'acronym_alias'),
  (24, 'Zhou Guanyu', 'Guanyu', 'Zhou', 'ZHO', 'G ZHOU', 'zhou', 'last_name_alias'),
  (24, 'Zhou Guanyu', 'Guanyu Zhou', 'Zhou', 'ZHO', 'G ZHOU', 'guanyu zhou', 'full_name_alias'),
  (24, 'Zhou Guanyu', 'Zhou Guanyu', 'Zhou', 'ZHO', 'G ZHOU', 'zhou guanyu', 'full_name_alias'),
  (24, 'Zhou Guanyu', NULL, NULL, 'ZHO', 'G ZHOU', 'zho', 'acronym_alias'),
  (20, 'Kevin Magnussen', 'Kevin', 'Magnussen', 'MAG', 'K MAGNUSSEN', 'kevin', 'first_name_alias'),
  (20, 'Kevin Magnussen', 'Kevin Magnussen', 'Magnussen', 'MAG', 'K MAGNUSSEN', 'kevin magnussen', 'full_name_alias'),
  (20, 'Kevin Magnussen', NULL, 'Magnussen', 'MAG', 'K MAGNUSSEN', 'magnussen', 'last_name_alias'),
  (20, 'Kevin Magnussen', NULL, NULL, 'MAG', 'K MAGNUSSEN', 'mag', 'acronym_alias'),
  (20, 'Kevin Magnussen', NULL, NULL, 'MAG', 'K MAGNUSSEN', 'k mag', 'nickname'),
  (2, 'Logan Sargeant', 'Logan', 'Sargeant', 'SAR', 'L SARGEANT', 'logan', 'first_name_alias'),
  (2, 'Logan Sargeant', 'Logan Sargeant', 'Sargeant', 'SAR', 'L SARGEANT', 'logan sargeant', 'full_name_alias'),
  (2, 'Logan Sargeant', NULL, 'Sargeant', 'SAR', 'L SARGEANT', 'sargeant', 'last_name_alias'),
  (2, 'Logan Sargeant', NULL, NULL, 'SAR', 'L SARGEANT', 'sar', 'acronym_alias'),
  (30, 'Liam Lawson', 'Liam', 'Lawson', 'LAW', 'L LAWSON', 'liam', 'first_name_alias'),
  (30, 'Liam Lawson', 'Liam Lawson', 'Lawson', 'LAW', 'L LAWSON', 'liam lawson', 'full_name_alias'),
  (30, 'Liam Lawson', NULL, 'Lawson', 'LAW', 'L LAWSON', 'lawson', 'last_name_alias'),
  (30, 'Liam Lawson', NULL, NULL, 'LAW', 'L LAWSON', 'law', 'acronym_alias'),
  (50, 'Oliver Bearman', 'Oliver', 'Bearman', 'BEA', 'O BEARMAN', 'oliver', 'first_name_alias'),
  (50, 'Oliver Bearman', 'Oliver Bearman', 'Bearman', 'BEA', 'O BEARMAN', 'oliver bearman', 'full_name_alias'),
  (50, 'Oliver Bearman', NULL, 'Bearman', 'BEA', 'O BEARMAN', 'bearman', 'last_name_alias'),
  (50, 'Oliver Bearman', NULL, NULL, 'BEA', 'O BEARMAN', 'bea', 'acronym_alias'),
  (50, 'Oliver Bearman', NULL, NULL, 'BEA', 'O BEARMAN', 'ollie', 'nickname'),
  (6, 'Jos Verstappen', 'Jos', 'Verstappen', 'VEJ', 'J VERSTAPPEN', 'jos verstappen', 'full_name_alias'),
  (6, 'Jos Verstappen', 'Jos', 'Verstappen', 'VEJ', 'J VERSTAPPEN', 'jos', 'first_name_alias'),
  (6, 'Jos Verstappen', NULL, NULL, 'VEJ', 'J VERSTAPPEN', 'verstappen sr', 'nickname')
ON CONFLICT DO NOTHING;

-- Teams
INSERT INTO core.team_alias_lookup (alias_text, alias_type, canonical_team_name, active_from_year, active_to_year, notes) VALUES
  ('rbr', 'name_alias', 'Red Bull Racing', NULL, NULL, '3-letter shorthand used in F1 timing screens'),
  ('energy drink', 'nickname', 'Red Bull Racing', NULL, NULL, 'Casual fan nickname'),
  ('prancing horse', 'nickname', 'Ferrari', NULL, NULL, 'Casual fan nickname for Scuderia Ferrari'),
  ('maranello', 'nickname', 'Ferrari', NULL, NULL, 'Casual nickname referring to Ferrari headquarters'),
  ('mer', 'name_alias', 'Mercedes', NULL, NULL, '3-letter shorthand'),
  ('silver arrows', 'nickname', 'Mercedes', NULL, NULL, 'Historical / casual fan nickname'),
  ('mcl', 'name_alias', 'McLaren', NULL, NULL, '3-letter shorthand'),
  ('papaya', 'nickname', 'McLaren', NULL, NULL, 'Casual fan nickname referring to team livery color'),
  ('ast', 'name_alias', 'Aston Martin', NULL, NULL, '3-letter shorthand'),
  ('green', 'nickname', 'Aston Martin', NULL, NULL, 'Casual livery-based nickname'),
  ('alp', 'name_alias', 'Alpine', NULL, NULL, '3-letter shorthand'),
  ('wil', 'name_alias', 'Williams', NULL, NULL, '3-letter shorthand'),
  ('has', 'name_alias', 'Haas F1 Team', NULL, NULL, '3-letter shorthand'),
  ('toro rosso', 'name_alias', 'AlphaTauri', NULL, 2019, 'Pre-rebrand identity that maps to AlphaTauri lineage'),
  ('visa cash app rb', 'branding_alias', 'Racing Bulls', 2024, 2024, '2024 sponsorship variant'),
  ('visa cash app racing bulls', 'branding_alias', 'Racing Bulls', 2025, NULL, '2025 sponsorship variant'),
  ('mercedes-amg petronas', 'branding_alias', 'Mercedes', NULL, NULL, 'Full team partnership name'),
  ('oracle red bull racing', 'branding_alias', 'Red Bull Racing', NULL, NULL, 'Full team partnership name')
ON CONFLICT DO NOTHING;

-- Venues
INSERT INTO core.session_venue_alias_lookup (alias_text, alias_type, country_name, location, circuit_short_name, notes) VALUES
  ('britain', 'country_alias', 'United Kingdom', NULL, NULL, 'UK shorthand'),
  ('britain gp', 'event_alias', 'United Kingdom', 'Silverstone', 'Silverstone', 'British GP nickname'),
  ('italy gp', 'event_alias', 'Italy', 'Monza', 'Monza', 'Italian Grand Prix variant'),
  ('monza gp', 'event_alias', 'Italy', 'Monza', 'Monza', 'Monza Grand Prix variant'),
  ('sao paulo', 'venue_alias', 'Brazil', 'São Paulo', 'Interlagos', 'São Paulo / Brazilian GP'),
  ('são paulo', 'venue_alias', 'Brazil', 'São Paulo', 'Interlagos', 'São Paulo / Brazilian GP'),
  ('sao paulo gp', 'event_alias', 'Brazil', 'São Paulo', 'Interlagos', 'São Paulo Grand Prix'),
  ('brazilian gp', 'event_alias', 'Brazil', 'São Paulo', 'Interlagos', 'Brazilian Grand Prix'),
  ('brazil', 'country_alias', 'Brazil', NULL, NULL, 'Country shorthand'),
  ('interlagos', 'venue_alias', 'Brazil', 'São Paulo', 'Interlagos', 'Interlagos circuit'),
  ('mexico', 'country_alias', 'Mexico', NULL, NULL, 'Country shorthand'),
  ('mexico city', 'venue_alias', 'Mexico', 'Mexico City', 'Mexico City', 'Mexico City GP venue'),
  ('mexico city gp', 'event_alias', 'Mexico', 'Mexico City', 'Mexico City', 'Mexico City Grand Prix'),
  ('mexican gp', 'event_alias', 'Mexico', 'Mexico City', 'Mexico City', 'Mexican Grand Prix'),
  ('qatar', 'country_alias', 'Qatar', NULL, NULL, 'Country shorthand'),
  ('qatar gp', 'event_alias', 'Qatar', 'Lusail', 'Lusail', 'Qatar Grand Prix'),
  ('lusail', 'venue_alias', 'Qatar', 'Lusail', 'Lusail', 'Lusail circuit'),
  ('canadian gp', 'event_alias', 'Canada', 'Montréal', 'Circuit Gilles Villeneuve', 'Canadian Grand Prix'),
  ('canada', 'country_alias', 'Canada', NULL, NULL, 'Country shorthand'),
  ('montreal', 'venue_alias', 'Canada', 'Montréal', 'Circuit Gilles Villeneuve', 'Canadian GP venue'),
  ('montréal', 'venue_alias', 'Canada', 'Montréal', 'Circuit Gilles Villeneuve', 'Canadian GP venue (with diacritic)'),
  ('gilles villeneuve', 'venue_alias', 'Canada', 'Montréal', 'Circuit Gilles Villeneuve', 'Circuit short name'),
  ('spanish gp', 'event_alias', 'Spain', 'Catalunya', 'Catalunya', 'Spanish Grand Prix'),
  ('spain', 'country_alias', 'Spain', NULL, NULL, 'Country shorthand'),
  ('catalunya', 'venue_alias', 'Spain', 'Catalunya', 'Catalunya', 'Catalunya circuit'),
  ('barcelona', 'venue_alias', 'Spain', 'Catalunya', 'Catalunya', 'Casual reference for Spanish GP'),
  ('chinese gp', 'event_alias', 'China', 'Shanghai', 'Shanghai', 'Chinese Grand Prix'),
  ('china', 'country_alias', 'China', NULL, NULL, 'Country shorthand'),
  ('shanghai', 'venue_alias', 'China', 'Shanghai', 'Shanghai', 'Shanghai International Circuit'),
  ('australian gp', 'event_alias', 'Australia', 'Melbourne', 'Albert Park', 'Australian Grand Prix'),
  ('australia', 'country_alias', 'Australia', NULL, NULL, 'Country shorthand'),
  ('melbourne', 'venue_alias', 'Australia', 'Melbourne', 'Albert Park', 'Albert Park venue'),
  ('albert park', 'venue_alias', 'Australia', 'Melbourne', 'Albert Park', 'Albert Park circuit'),
  ('dutch gp', 'event_alias', 'Netherlands', 'Zandvoort', 'Zandvoort', 'Dutch Grand Prix'),
  ('netherlands', 'country_alias', 'Netherlands', NULL, NULL, 'Country shorthand'),
  ('zandvoort', 'venue_alias', 'Netherlands', 'Zandvoort', 'Zandvoort', 'Dutch GP venue'),
  ('hungarian gp', 'event_alias', 'Hungary', 'Mogyoród', 'Hungaroring', 'Hungarian Grand Prix'),
  ('hungary', 'country_alias', 'Hungary', NULL, NULL, 'Country shorthand'),
  ('hungaroring', 'venue_alias', 'Hungary', 'Mogyoród', 'Hungaroring', 'Hungarian GP circuit'),
  ('azerbaijan gp', 'event_alias', 'Azerbaijan', 'Baku', 'Baku City Circuit', 'Azerbaijan Grand Prix'),
  ('azerbaijan', 'country_alias', 'Azerbaijan', NULL, NULL, 'Country shorthand'),
  ('baku', 'venue_alias', 'Azerbaijan', 'Baku', 'Baku City Circuit', 'Baku street circuit'),
  ('austrian gp', 'event_alias', 'Austria', 'Spielberg', 'Red Bull Ring', 'Austrian Grand Prix'),
  ('austria', 'country_alias', 'Austria', NULL, NULL, 'Country shorthand'),
  ('spielberg', 'venue_alias', 'Austria', 'Spielberg', 'Red Bull Ring', 'Spielberg location'),
  ('red bull ring', 'venue_alias', 'Austria', 'Spielberg', 'Red Bull Ring', 'Austrian GP circuit'),
  ('japanese', 'event_alias', 'Japan', 'Suzuka', 'Suzuka', 'Japanese Grand Prix variant'),
  ('saudi arabian gp', 'event_alias', 'Saudi Arabia', 'Jeddah', 'Jeddah', 'Saudi Arabian Grand Prix'),
  ('the ardennes', 'nickname', 'Belgium', 'Spa-Francorchamps', 'Spa-Francorchamps', 'Casual fan nickname for Spa'),
  ('the tilkedrome', 'nickname', 'United Arab Emirates', 'Yas Island', 'Yas Marina', 'Casual nickname for Hermann-Tilke-designed circuit'),
  ('yas', 'venue_alias', 'United Arab Emirates', 'Yas Island', 'Yas Marina', 'Yas Island shorthand')
ON CONFLICT DO NOTHING;

-- Re-normalize alias columns so the COALESCE(normalized_alias, ...)
-- fallback in the partial-unique indexes never fires (defensive: this
-- is what the seed loader does after a CSV reload).
UPDATE core.driver_alias_lookup
   SET normalized_alias = public.f1_unaccent(LOWER(BTRIM(alias_text)))
 WHERE normalized_alias IS NULL OR normalized_alias <> public.f1_unaccent(LOWER(BTRIM(alias_text)));

UPDATE core.team_alias_lookup
   SET normalized_alias = public.f1_unaccent(LOWER(BTRIM(alias_text)))
 WHERE normalized_alias IS NULL OR normalized_alias <> public.f1_unaccent(LOWER(BTRIM(alias_text)));

UPDATE core.session_venue_alias_lookup
   SET normalized_alias = public.f1_unaccent(LOWER(BTRIM(alias_text)))
 WHERE normalized_alias IS NULL OR normalized_alias <> public.f1_unaccent(LOWER(BTRIM(alias_text)));

COMMIT;
