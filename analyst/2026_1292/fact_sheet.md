# Fact sheet — Dutch Grand Prix 2026 (session 11353, 72 laps)

Every number the article uses MUST be one of the values below, rendered as shown, and cited by id. Numbers not on this sheet are refused by the binder.

## Results and grid (packet:results)
N1    1st        results.0.position                           Norris finished 1st
N2    1st        results.0.grid                               Norris started 1st
N3    2nd        results.1.position                           Antonelli finished 2nd
N4    3rd        results.1.grid                               Antonelli started 3rd
N5    3rd        results.2.position                           Russell finished 3rd
N6    2nd        results.2.grid                               Russell started 2nd
N7    4th        results.3.position                           Hamilton finished 4th
N8    5th        results.3.grid                               Hamilton started 5th
N9    5th        results.4.position                           Leclerc finished 5th
N10   6th        results.4.grid                               Leclerc started 6th
N11   6th        results.5.position                           Piastri finished 6th
N12   4th        results.5.grid                               Piastri started 4th
N13   7th        results.6.position                           Lawson finished 7th
N14   8th        results.6.grid                               Lawson started 8th
N15   8th        results.7.position                           Hulkenberg finished 8th
N16   13th       results.7.grid                               Hulkenberg started 13th
N17   9th        results.8.position                           Alonso finished 9th
N18   18th       results.8.grid                               Alonso started 18th
N19   10th       results.9.position                           Gasly finished 10th
N20   11th       results.9.grid                               Gasly started 11th
N21   67         results.16.last_completed_lap                Albon retired after lap 67 (DNF)
N22   62         results.17.last_completed_lap                Bottas retired after lap 62 (DNF)
N23   53         results.18.last_completed_lap                Ocon retired after lap 53 (DNF)
N24   46         results.19.last_completed_lap                Stroll retired after lap 46 (DNF)
N25   3          results.20.last_completed_lap                Bearman retired after lap 3 (DNF)
N26   1          results.21.last_completed_lap                Verstappen retired after lap 1 (DNF)
N27   72         session.total_laps                           race distance in laps
N28   11.536     position_trace.ANT.71.gap                    official margin: Antonelli behind Norris at the flag (s)
N29   1m14.230s  fastest_laps.0.time_s                        fastest lap of the race: Leclerc on lap 60
N30   60         fastest_laps.0.lap                           lap of the fastest lap (Leclerc)

## Racing state (packet:timeline.intervals) and lead changes (packet:lead_changes)
N31   2          timeline.intervals.0.start_lap               RED began lap
N32   3          timeline.intervals.0.end_lap                 RED ended lap (end INFERRED: resumption_state_msg)
N33   3          timeline.intervals.1.start_lap               SC began lap
N34   3          timeline.intervals.1.end_lap                 SC ended lap (end INFERRED: lights_on_lap_end)
N35   55         timeline.intervals.2.start_lap               VSC began lap
N36   57         timeline.intervals.2.end_lap                 VSC ended lap
N37   70         timeline.intervals.3.start_lap               VSC began lap
N38   70         timeline.intervals.3.end_lap                 VSC ended lap
N39   5          lead_changes.0.lap                           Antonelli led at the end of lap 5; lead changes are end-of-lap order
N40   22         lead_changes.1.lap                           Hamilton led at the end of lap 22 (from Antonelli); lead changes are end-of-lap order
N41   25         lead_changes.2.lap                           Antonelli led at the end of lap 25 (from Hamilton); lead changes are end-of-lap order
N42   40         lead_changes.3.lap                           Norris led at the end of lap 40 (from Antonelli); lead changes are end-of-lap order
N43   48         lead_changes.4.lap                           Hamilton led at the end of lap 48 (from Norris); lead changes are end-of-lap order
N44   54         lead_changes.5.lap                           Norris led at the end of lap 54 (from Hamilton); lead changes are end-of-lap order

## Stops (packet:stops; lane_time_s = pit-lane time, NOT net loss) and stints (packet:stints)
N45   2          stops.0.lap                                  Norris stopped on lap 2 (MEDIUM→SOFT, boundary_spanning)
N46   2          stops.1.lap                                  Antonelli stopped on lap 2 (MEDIUM→MEDIUM, boundary_spanning)
N47   2          stops.2.lap                                  Russell stopped on lap 2 (MEDIUM→MEDIUM, boundary_spanning)
N48   2          stops.3.lap                                  Leclerc stopped on lap 2 (SOFT→SOFT, boundary_spanning)
N49   2          stops.4.lap                                  Piastri stopped on lap 2 (MEDIUM→HARD, boundary_spanning)
N50   2          stops.5.lap                                  Hamilton stopped on lap 2 (SOFT→SOFT, boundary_spanning)
N51   17         stops.26.lap                                 Russell stopped on lap 17 (MEDIUM→HARD, green)
N52   18.0       stops.26.lane_time_s                         Russell lap-17 pit-lane time (s)
N53   18         stops.27.lap                                 Piastri stopped on lap 18 (HARD→HARD, green)
N54   20.2       stops.27.lane_time_s                         Piastri lap-18 pit-lane time (s)
N55   21         stops.31.lap                                 Antonelli stopped on lap 21 (MEDIUM→HARD, green)
N56   18.7       stops.31.lane_time_s                         Antonelli lap-21 pit-lane time (s)
N57   21         stops.32.lap                                 Norris stopped on lap 21 (SOFT→HARD, green)
N58   18.0       stops.32.lane_time_s                         Norris lap-21 pit-lane time (s)
N59   21         stops.33.lap                                 Leclerc stopped on lap 21 (SOFT→MEDIUM, green)
N60   19.7       stops.33.lane_time_s                         Leclerc lap-21 pit-lane time (s)
N61   25         stops.36.lap                                 Hamilton stopped on lap 25 (SOFT→HARD, green)
N62   17.8       stops.36.lane_time_s                         Hamilton lap-25 pit-lane time (s)
N63   40         stops.46.lap                                 Antonelli stopped on lap 40 (HARD→HARD, green)
N64   17.7       stops.46.lane_time_s                         Antonelli lap-40 pit-lane time (s)
N65   40         stops.47.lap                                 Russell stopped on lap 40 (HARD→HARD, green)
N66   17.4       stops.47.lane_time_s                         Russell lap-40 pit-lane time (s)
N67   43         stops.48.lap                                 Leclerc stopped on lap 43 (MEDIUM→HARD, green)
N68   18.7       stops.48.lane_time_s                         Leclerc lap-43 pit-lane time (s)
N69   44         stops.49.lap                                 Piastri stopped on lap 44 (HARD→SOFT, green)
N70   18.1       stops.49.lane_time_s                         Piastri lap-44 pit-lane time (s)
N71   47         stops.52.lap                                 Norris stopped on lap 47 (HARD→HARD, green)
N72   17.5       stops.52.lane_time_s                         Norris lap-47 pit-lane time (s)
N73   55         stops.60.lap                                 Hamilton stopped on lap 55 (HARD→SOFT, vsc)
N74   18.7       stops.60.lane_time_s                         Hamilton lap-55 pit-lane time (s)
N75   55         stops.61.lap                                 Leclerc stopped on lap 55 (HARD→SOFT, vsc)
N76   18.7       stops.61.lane_time_s                         Leclerc lap-55 pit-lane time (s)
N77   55         stops.62.lap                                 Piastri stopped on lap 55 (SOFT→SOFT, vsc)
N78   17.8       stops.62.lane_time_s                         Piastri lap-55 pit-lane time (s)
N79   56         stops.63.lap                                 Antonelli stopped on lap 56 (HARD→SOFT, vsc)
N80   19.1       stops.63.lane_time_s                         Antonelli lap-56 pit-lane time (s)
      Norris     stint 1: medium laps 1–2   (stints.0)
      Norris     stint 2: soft laps 3–21   (stints.1)
      Norris     stint 3: hard laps 22–47   (stints.2)
      Norris     stint 4: hard laps 48–72   (stints.3)
      Antonelli  stint 1: medium laps 1–2   (stints.18)
      Antonelli  stint 2: medium laps 3–21   (stints.19)
      Antonelli  stint 3: hard laps 22–40   (stints.20)
      Antonelli  stint 4: hard laps 41–56   (stints.21)
      Antonelli  stint 5: soft laps 57–72   (stints.22)
      Leclerc    stint 1: soft laps 1–2   (stints.26)
      Leclerc    stint 2: soft laps 3–21   (stints.27)
      Leclerc    stint 3: medium laps 22–43   (stints.28)
      Leclerc    stint 4: hard laps 44–55   (stints.29)
      Leclerc    stint 5: soft laps 56–72   (stints.30)
      Hamilton   stint 1: soft laps 1–2   (stints.64)
      Hamilton   stint 2: soft laps 3–25   (stints.65)
      Hamilton   stint 3: hard laps 26–55   (stints.66)
      Hamilton   stint 4: soft laps 56–72   (stints.67)
      Russell    stint 1: medium laps 1–2   (stints.72)
      Russell    stint 2: medium laps 3–17   (stints.73)
      Russell    stint 3: hard laps 18–40   (stints.74)
      Russell    stint 4: hard laps 41–72   (stints.75)
      Piastri    stint 1: medium laps 1–2   (stints.80)
      Piastri    stint 2: hard laps 3–18   (stints.81)
      Piastri    stint 3: hard laps 19–44   (stints.82)
      Piastri    stint 4: soft laps 45–55   (stints.83)
      Piastri    stint 5: soft laps 56–72   (stints.84)

## Gap Antonelli behind Norris at the END of each lap (packet:pair_gaps.1; line-crossing definition; negative = Antonelli ahead)
N81   0.711      pair_gaps.1.laps.0.gap                       gap at end of lap 1 (observed)
N82   1.8        pair_gaps.1.laps.1.gap                       gap at end of lap 2 (observed)
N83   3.4        pair_gaps.1.laps.2.gap                       gap at end of lap 3 (observed)
N84   2.8        pair_gaps.1.laps.3.gap                       gap at end of lap 4 (observed)
N85   -1.0       pair_gaps.1.laps.4.gap                       gap at end of lap 5 (observed)
N86   -1.2       pair_gaps.1.laps.9.gap                       gap at end of lap 10 (observed)
N87   -2.2       pair_gaps.1.laps.14.gap                      gap at end of lap 15 (observed)
N88   -2.3       pair_gaps.1.laps.19.gap                      gap at end of lap 20 (observed)
N89   -2.3       pair_gaps.1.laps.20.gap                      gap at end of lap 21 (observed)
N90   -1.4       pair_gaps.1.laps.21.gap                      gap at end of lap 22 (observed)
N91   -1.6       pair_gaps.1.laps.23.gap                      gap at end of lap 24 (observed)
N92   -1.6       pair_gaps.1.laps.24.gap                      gap at end of lap 25 (observed)
N93   -0.680     pair_gaps.1.laps.29.gap                      gap at end of lap 30 (observed)
N94   -0.994     pair_gaps.1.laps.34.gap                      gap at end of lap 35 (observed)
N95   -0.706     pair_gaps.1.laps.38.gap                      gap at end of lap 39 (observed)
N96   1.7        pair_gaps.1.laps.39.gap                      gap at end of lap 40 (observed)
N97   17.9       pair_gaps.1.laps.40.gap                      gap at end of lap 41 (observed)
N98   15.2       pair_gaps.1.laps.44.gap                      gap at end of lap 45 (observed)
N99   14.2       pair_gaps.1.laps.45.gap                      gap at end of lap 46 (observed)
N100  10.9       pair_gaps.1.laps.46.gap                      gap at end of lap 47 (observed)
N101  -5.0       pair_gaps.1.laps.47.gap                      gap at end of lap 48 (observed)
N102  -1.7       pair_gaps.1.laps.49.gap                      gap at end of lap 50 (observed)
N103  -0.172     pair_gaps.1.laps.52.gap                      gap at end of lap 53 (observed)
N104  1.2        pair_gaps.1.laps.53.gap                      gap at end of lap 54 (observed)
N105  1.4        pair_gaps.1.laps.54.gap                      gap at end of lap 55 (observed)
N106  4.2        pair_gaps.1.laps.55.gap                      gap at end of lap 56 (observed)
N107  12.6       pair_gaps.1.laps.56.gap                      gap at end of lap 57 (observed)
N108  12.4       pair_gaps.1.laps.59.gap                      gap at end of lap 60 (observed)
N109  12.0       pair_gaps.1.laps.64.gap                      gap at end of lap 65 (observed)
N110  11.6       pair_gaps.1.laps.68.gap                      gap at end of lap 69 (observed)
N111  11.1       pair_gaps.1.laps.69.gap                      gap at end of lap 70 (observed)
N112  11.5       pair_gaps.1.laps.71.gap                      gap at end of lap 72 (observed)

## Championship (packet:standings_after)
N113  242        standings_after.0.after                      Antonelli points after the race
N114  183        standings_after.1.after                      Russell points after the race
N115  183        standings_after.2.after                      Hamilton points after the race
N116  159        standings_after.3.after                      Norris points after the race
N117  155        standings_after.4.after                      Leclerc points after the race
N118  59         standings_after.0.after − standings_after.1.after leader's margin over second (derived)

## Race control (packet:timeline.events) — describe in ordinary language, never quote the log
      lap  1  events.27  INCIDENT INVOLVING CAR 23 (ALB) NOTED - FAILING TO FOLLOW RACE DIRECTORS INSTRUCTIONS
      lap  1  events.28  INCIDENT INVOLVING CAR 3 (VER) NOTED - FAILING TO FOLLOW RACE DIRECTORS INSTRUCTIONS
      lap  1  events.29  INCIDENT INVOLVING CAR 55 (SAI) NOTED - FAILING TO FOLLOW RACE DIRECTORS INSTRUCTIONS
      lap  1  events.30  INCIDENT INVOLVING CAR 44 (HAM) NOTED - FAILING TO FOLLOW RACE DIRECTORS INSTRUCTIONS
      lap  1  events.34  INCIDENT INVOLVING CAR 43 (COL) NOTED - FAILING TO FOLLOW RACE DIRECTORS INSTRUCTIONS
      lap  1  events.43  FIA STEWARDS: INCIDENT INVOLVING CAR 23 (ALB) REVIEWED NO FURTHER INVESTIGATION - FAILING TO FOLLOW RACE DIREC
      lap  1  events.45  FIA STEWARDS: INCIDENT INVOLVING CAR 3 (VER) REVIEWED NO FURTHER INVESTIGATION - FAILING TO FOLLOW RACE DIRECT
      lap  1  events.47  FIA STEWARDS: INCIDENT INVOLVING CAR 55 (SAI) REVIEWED NO FURTHER INVESTIGATION - FAILING TO FOLLOW RACE DIREC
      lap  1  events.48  FIA STEWARDS: INCIDENT INVOLVING CAR 44 (HAM) REVIEWED NO FURTHER INVESTIGATION - FAILING TO FOLLOW RACE DIREC
      lap  1  events.50  FIA STEWARDS: INCIDENT INVOLVING CAR 43 (COL) REVIEWED NO FURTHER INVESTIGATION - FAILING TO FOLLOW RACE DIREC
      lap  1  events.90  SAFETY CAR LIGHTS ON
      lap  2  events.98  RED FLAG - RACE SUSPENDED
      lap  3  events.113  TURN 14 INCIDENT INVOLVING CAR 41 (LIN) NOTED - YELLOW FLAG INFRINGEMENT (15:04:49)
      lap  3  events.115  TURN 14 INCIDENT INVOLVING CAR 31 (OCO) NOTED - YELLOW FLAG INFRINGEMENT (15:04:54)
      lap  3  events.116  TURN 14 INCIDENT INVOLVING CAR 43 (COL) NOTED - YELLOW FLAG INFRINGEMENT (15:04:50)
      lap  3  events.120  FIA STEWARDS: TURN 14 INCIDENT INVOLVING CAR 31 (OCO) REVIEWED NO FURTHER INVESTIGATION - YELLOW FLAG INFRINGE
      lap  3  events.129  FIA STEWARDS: TURN 14 INCIDENT INVOLVING CAR 41 (LIN) UNDER INVESTIGATION - YELLOW FLAG INFRINGEMENT (15:04:49
      lap  3  events.130  SAFETY CAR LIGHTS ON
      lap  3  events.131  FIA STEWARDS: TURN 14 INCIDENT INVOLVING CAR 43 (COL) UNDER INVESTIGATION - YELLOW FLAG INFRINGEMENT (15:04:50
      lap  5  events.138  FIA STEWARDS: DRIVE THROUGH PENALTY FOR CAR 41 (LIN) - YELLOW FLAG INFRINGEMENT (15:04:49)
      lap  7  events.142  FIA STEWARDS: DRIVE THROUGH PENALTY FOR CAR 43 (COL) - YELLOW FLAG INFRINGEMENT (15:04:50)
      lap  9  events.143  INCIDENT INVOLVING CAR 87 (BEA) NOTED - LEAVING PIT EXIT ON RED LIGHT (15:33:53)
      lap 10  events.144  INCIDENT INVOLVING CAR 5 (BOR) NOTED - LEAVING PIT EXIT ON RED LIGHT (15:33:53)
      lap 12  events.145  FIA STEWARDS: INCIDENT INVOLVING CAR 87 (BEA) WILL BE INVESTIGATED AFTER THE RACE - LEAVING PIT EXIT ON RED LI
      lap 12  events.146  FIA STEWARDS: INCIDENT INVOLVING CAR 5 (BOR) WILL BE INVESTIGATED AFTER THE RACE - LEAVING PIT EXIT ON RED LIG
      lap 13  events.147  FIA STEWARDS: PENALTY SERVED - DRIVE THROUGH PENALTY FOR CAR 41 (LIN) - YELLOW FLAG INFRINGEMENT (15:04:49)
      lap 13  events.148  FIA STEWARDS: PENALTY SERVED - DRIVE THROUGH PENALTY FOR CAR 43 (COL) - YELLOW FLAG INFRINGEMENT (15:04:50)
      lap 36  events.169  TURN 1 INCIDENT INVOLVING CARS 81 (PIA) AND 44 (HAM) NOTED - DRIVING ERRATICALLY (16:18:41)
      lap 38  events.176  FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 81 (PIA) AND 44 (HAM) REVIEWED NO FURTHER INVESTIGATION - DRIVING
      lap 55  events.232  VSC DEPLOYED
      lap 57  events.237  VSC ENDING
      lap 60  events.257  INCIDENT INVOLVING CAR 43 (COL) NOTED - YELLOW FLAG INFRINGEMENT (16:44:04)
      lap 62  events.264  INCIDENT INVOLVING CAR 30 (LAW) NOTED - YELLOW FLAG INFRINGEMENT (16:44:04)
      lap 66  events.274  FIA STEWARDS: INCIDENT INVOLVING CAR 43 (COL) UNDER INVESTIGATION - YELLOW FLAG INFRINGEMENT (16:44:04)
      lap 68  events.281  FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 43 (COL) - YELLOW FLAG INFRINGEMENT (16:44:04)
      lap 68  events.285  FIA STEWARDS: INCIDENT INVOLVING CAR 30 (LAW) UNDER INVESTIGATION - YELLOW FLAG INFRINGEMENT (16:44:04)
      lap 70  events.288  VSC DEPLOYED
      lap 70  events.290  FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 30 (LAW) - YELLOW FLAG INFRINGEMENT (16:44:04)
      lap 70  events.294  VSC ENDING
      lap 71  events.300  TURN 1 INCIDENT INVOLVING CARS 55 (SAI) AND 23 (ALB) NOTED - CAUSING A COLLISION (17:04:55)
      lap 71  events.301  FIA STEWARDS: TURN 1 INCIDENT INVOLVING CARS 55 (SAI) AND 23 (ALB) UNDER INVESTIGATION - CAUSING A COLLISION (
      lap 71  events.302  FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 55 (SAI) - CAUSING A COLLISION (17:04:55)

## Computed context facts (cite as context:<id>; numbers inside are allowed)
      context:nationality_circuit    Lando Norris is the first British driver to win the Dutch Grand Prix since James Hunt in 1976.
      context:nationality_any        Before Lando Norris, the last British driver to win a grand prix was George Russell at the 2026 Austrian Grand Prix.
      context:season_wins            The Dutch Grand Prix was Lando Norris's second win of the 2026 season.
      context:career_wins            It was the 13th grand prix win of Lando Norris's career.
      context:pole_to_win            Lando Norris won from pole; 17 of the 35 previous Dutch Grand Prix winners on record started from pole, 7 of the last 10.
      context:back_to_back           Lando Norris won the previous round too, the Hungarian Grand Prix, making it back-to-back wins.
      context:season_winners         After round 12, 5 different drivers have won in 2026; with multiple wins: RUS (2), ANT (6), NOR (2).
      context:standings_after        After round 12 Andrea Kimi Antonelli leads the championship on 242 points, 59 clear of George Russell; Lando Norris is 4th on 159, 83 behind.

## Official documents (tier 1; cite as reporting:<id>; facts, not quotes)
      reporting:fia:1292:13          Infringement - Free Practice 1 Deleted Lap Times Double Yellow — Title Description Enclosed Infringement - Free Practice 1 Deleted Lap Times Double Yellow Infringement - Free Practice 1 Deleted Lap Times Double Yellow NED DOC
      reporting:fia:1292:14          Infringement - Free Practice 1 Deleted Lap Times — Title Description Enclosed Infringement - Free Practice 1 Deleted Lap Times Infringement - Free Practice 1 Deleted Lap Times NED DOC 14 - Free Practice 1 Delete
      reporting:fia:1292:19          Decision - Sprint Qualifying Deleted Lap Times — Title Description Enclosed Decision - Sprint Qualifying Deleted Lap Times Decision - Sprint Qualifying Deleted Lap Times NED DOC 19 - Sprint Qualifying Deleted 
      reporting:fia:1292:20          Decision - Sprint Qualifying SC2-SC1 Times — Title Description Enclosed Decision - Sprint Qualifying SC2-SC1 Times Decision - Sprint Qualifying SC2-SC1 Times NED DOC 20 - Sprint Qualifying SC2-SC1 Times.pd
      reporting:fia:1292:17          Summons - Car 55 - Alleged driving unnecessarily slowly during sprint qualifying — The driver and team representative are required to report to the Stewards at 18:00 in relation to the incident below: No / Driver Reason 55 - Carlos Sainz Alleg
      reporting:fia:1292:22          Infringement- Car 55 - driving unnecessarily slowly during sprint qualifying — The Stewards, having received a report from the Race Director, summoned (document 17) and heard from the driver and team representative, have considered the fol
      reporting:fia:1292:29          Infringement - Car 55 - Changes made during Parc Ferme — The Stewards, having received a report from the Technical Delegate (document 28), have considered the following matter and determine the following: No / Driver 
      reporting:fia:1292:30          Infringement - Car 14 - Changes made during Parc Ferme — The Stewards, having received a report from the Technical Delegate (document 28), have considered the following matter and determine the following: No / Driver 
      reporting:fia:1292:33          Infringement - Car 55 - Starting procedure infringement — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 55 - Carlos Sainz C
      reporting:fia:1292:35          Summons - Car 5 - Alleged unsafe release — The team representative is required to report to the Stewards at 13:15, in relation to the incident below: No / Driver Reason 5 - Gabriel Bortoleto Alleged brea
      reporting:fia:1292:36          Infringement - Sprint Deleted Lap Times — Title Infringement - Sprint Deleted Lap Times Description Sprint Deleted Lap Times Enclosed NED DOC 36 - Sprint Deleted Lap Times.pdf Felix Holter Mathieu Remme
      reporting:fia:1292:37          Infringement - Car 77 - Failure to follow Race Director's Instructions (Reaching — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 77 - Valtteri Botta
      reporting:fia:1292:38          Infringement - Car 44 - Failure to follow Race Director's Instructions (Reaching — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 44 - Lewis Hamilton
      reporting:fia:1292:39          Infringement - Car 3 - Failure to follow Race Director's Instructions (Reaching  — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 3 - Max Verstappen 
      reporting:fia:1292:40          Infringement - Car 22 - Failure to follow Race Director's Instructions (Reaching — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 22 - Yuki Tsunoda C
      reporting:fia:1292:41          Infringement - Car 18 - Failure to follow Race Director's Instructions (Reaching — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 18 - Lance Stroll C
      reporting:fia:1292:42          Infringement - Car 5 - Unsafe release — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 5 - Gabriel Bortole
      reporting:fia:1292:47          Summons - Car 10 - Alleged unsafe release — The team representative is required to report to the Stewards at 17:45, in relation to the incident below: No / Driver Reason 10 - Pierre Gasly Alleged breach o
      reporting:fia:1292:48          Summons - Car 5 - Alleged unsafe release by Car 10 — The driver and the team representative are required to report to the Stewards at 17:45, in relation to the incident below: No / Driver Reason 5 - Gabriel Bortol
      reporting:fia:1292:52          Decision - Car 10 - alleged unsafe release — The Stewards, having received a report from the Race Director, summoned (documents 47 & 48) and heard from the drivers and team representatives, have considered
      reporting:fia:1292:59          Infringement - Car 11 - Changes made in Parc Ferme — The Stewards, having received a report from the Technical Delegate (document 58), have considered the following matter and determine the following: No / Driver 
      reporting:fia:1292:63          Infringement - Car 43 - Overtaking under yellow flags — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 43 - Franco Colapin
      reporting:fia:1292:62          Infringement - Car 41 - Overtaking under yellow flags — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 41 - Arvid Lindblad
      reporting:fia:1292:65          Infringement - Car 43 - Failure to slow for yellow flags — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 43 - Franco Colapin
      reporting:fia:1292:66          Infringement - Car 30 - Failure to follow for yellow flags — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 30 - Liam Lawson Co
      reporting:fia:1292:67          Infringement - Race Deleted Lap Times — Title Infringement - Race Deleted Lap Times Description Race Deleted Lap Times Enclosed NED DOC 67 - Race Deleted Lap Times.pdf Felix Holter Mathieu Remmerie To
      reporting:fia:1292:68          Infringement - Car 55 - Collision with Car 23 — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 55 - Carlos Sainz C
      reporting:fia:1292:69          Infringement - Car 87 - Red Light at Pit Exit — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 87 - Oliver Bearman
      reporting:fia:1292:70          Infringement - Car 5 - Red Light at Pit Exit — The Stewards, having received a report from the Race Director, have considered the following matter and determine the following: No / Driver 5 - Gabriel Bortole

## Registered reporting (tier 2; cite as reporting:<id>; attribute; quotes ≤ 4 words)
      reporting:article:571fd11450   Norris wins dramatic Dutch Grand Prix as Verstappen crashes (f1com, 2026-08-23T15:27) https://www.formula1.com/en/latest/article/norris-wins-dramatic-dutch-grand-prix-from-antonelli-and-russell-as-verstappen-crashes-out.Zn7iYevVGp5eHzFkTEAz7
      > NetherlandsRace2026Norris wins dramatic Dutch Grand Prix from Antonelli and Russell as Verstappen crashes outLando Norris emerged as the victor of an action-packed Dutch Grand Prix, the McLaren driver crossing the line ahead of the Mercedes pair of Kimi Antonelli and George Russell. Aug 23, 2026 3:27pm UTCLando Norris has taken his second consecutive victory of the season during an eventful Dutch Grand Prix, the Briton beating Kimi Antonelli to the win while home favourite Max Verstappen suffered a dramatic crash that resulted in the race being red-flagged. After Norris initially led away from pole position at the start, the race was halted just one lap later when Verstappen lost the rear of his Red Bull and hit the wall heavily. The Dutchman fortunately reported that he was okay. When the action resumed, Antonelli made a flying start to overtake Norris for P1 and from there stretched out a lead – but as the race entered its final third, Norris made ground and retook the position from the Mercedes. A late Virtual Safety Car – called due to Esteban Ocon’s Haas stopping out on track – resulted in a number of drivers pitting including Antonelli, setting up for a potential chase to the end as both Norris and George Russell in front of him had not stopped for fresh tyres. While the Silver Arrows inverted their cars to release Antonelli into second, Norris would prove unbeatable at the front and crossed the line with an 11.536s margin over the championship leader. Russell, meanwhile, just sealed the final spot on the podium in third, having fended off the chasing Ferraris to the very end. Lewis Hamilton and Charles Leclerc had to settle for fourth and fifth respectively, with McLaren’s Oscar Piastri claiming sixth. Liam Lawson placed seventh as the sole Red Bull to finish, th
      reporting:article:045b28d03a   Verstappen reacts to dramatic Dutch GP crash (f1com, 2026-08-23T15:38) https://www.formula1.com/en/latest/article/verstappen-reacts-to-dramatic-dutch-gp-crash-as-he-sums-up-disappointing-home-weekend.6nrEOE03YhjdJy6shRzAf1
      > Max VerstappenRed Bull RacingNetherlandsShow more tagsVerstappen reacts to dramatic Dutch GP crash as he sums up ‘disappointing’ home weekendMax Verstappen’s home race at Zandvoort ended shortly after it started with a high-speed accident. Aug 23, 2026 3:38pm UTCMax Verstappen was unable to complete a lap of Sunday’s Dutch Grand Prix at the Zandvoort Circuit, with the Red Bull driver dramatically crashing out in front of his home fans. Verstappen arrived at the event amid a wave of positivity after agreeing a contract extension that will keep him at the Milton Keynes-based team until at least the end of 2030. However, as Red Bull struggled for pace throughout the Sprint event, the four-time World Champion’s already “disappointing” weekend concluded when he rounded the final corner of his opening lap. Losing control on the inside of the banking, which was still damp in places due to pre-race showers, Verstappen’s car slammed into the barriers on the outside of the track, slid back across it and then came to a halt with one of its wheels missing. Asked how he was feeling when he arrived at the television pen, given the significant impact, Verstappen said: “Good. I think I still hit the SAFER barrier maybe, potentially. “But I think also a more frontal impact [with the barrier] is actually a bit better than a sideways one, so from that sense all okay.” Verstappen was then asked for his overriding emotions from the weekend as a whole – Zandvoort, and his home race, now dropping off the F1 calendar. “This weekend, of course, [was] disappointing,” he said. “I think disappointing pace, and a disappointing end to the weekend. I think you can sum it up like that.” F1 Store - Red Bull RacingCheck out the latest Red Bull Racing products in the F1 Store.SHOP NOWNext Up Related Arti
      reporting:article:b25de7596c   Norris dissects the ‘move that won me’ the final Dutch GP (f1com, 2026-08-23T16:08) https://www.formula1.com/en/latest/article/we-needed-to-put-on-a-show-norris-dissects-the-move-that-won-me-the-final-dutch-gp.6fS1X9q1vngxLevmcyQan4
      > Lando NorrisMcLarenNetherlandsShow more tags‘We needed to put on a show’ – Norris dissects the ‘move that won me’ the final Dutch GPLando Norris thrived in the battle to win the Dutch Grand Prix, beating Mercedes’ Kimi Antonelli and George Russell. Aug 23, 2026 4:08pm UTCLando Norris was left feeling “over the moon” after he passed Kimi Antonelli and Lewis Hamilton with a pair of spectacular overtakes to win the Dutch Grand Prix, marking his second victory of the season. Starting from pole position, the McLaren driver’s clean opening lap was halted following a scary crash for Red Bull’s Max Verstappen, which resulted in a red flag and eventual restart for the remaining competitors. It was on this second attempt that Norris lost the lead to Antonelli, forcing him to launch an attack that lasted for the majority of the race. Through multiple pit stops, he dropped to third place on track and patiently waited for the perfect time to strike, which came on Lap 54 of 72. Heading into Turn 1, the reigning World Champion went around the outside of Antonelli in a decisive manoeuvre before closing up to Hamilton, who he passed on the same lap to reclaim the lead. “Yesterday I said we needed to put on a bit of a show for everyone for the final race here, so I made it tough for myself today but [it was] a good race, well-fought,” Norris reflected. “Probably one of my better wins – we had to fight for it well but the pace was strong. “We managed things incredibly well today so [I'm] over the moon, very happy. Nice to win the final race here in Zandvoort. Norris had a fantastic battle with Antonelli and Hamilton for the win“The move was good. I knew I wasn’t going to get many chances. Every lap I spent behind [Antonelli], my odds were getting lower and lower. I saw Lewis defended and 
      reporting:article:a12a0fb0cb   Antonelli details what ‘saved’ Mercedes after P2 in Dutch GP (f1com, 2026-08-23T16:35) https://www.formula1.com/en/latest/article/antonelli-details-what-saved-mercedes-as-he-admits-being-disappointed-by-p2-in-dutch-grand-prix.7Cebf84txGCxavWTdiKBs4
      > Kimi AntonelliMercedesNetherlandsShow more tagsAntonelli details what ‘saved’ Mercedes as he admits being ‘disappointed’ by P2 in Dutch Grand PrixKimi Antonelli ended an eventful Dutch Grand Prix in second place, bringing a close to a weekend in which the Mercedes driver admitted to lacking confidence in the car. Aug 23, 2026 4:35pm UTCKimi Antonelli was left disappointed at ending the Dutch Grand Prix in second place but has also taken the positives from a weekend where he had struggled for confidence in the car, with the Italian feeling that his two strong starts “saved” his race. After overtaking Mercedes team mate George Russell for P2 when the event got underway, Antonelli went one better during the subsequent restart – with the race red-flagged following a heavy crash for Max Verstappen – and snatched the lead from Lando Norris. While Antonelli went on to hold the position for many laps, Norris had caught up to the championship leader during the final third of the Grand Prix and retook P1. The 19-year-old opted to make an extra pit stop when a late Virtual Safety Car was called, dropping him behind Russell – but Mercedes made the call to invert their cars, allowing Antonelli to move up into second. Reflecting on the race afterwards, the Italian said: “[I’m] a bit disappointed because we've led most of that half of the race. But yeah, on that last stint on the hard [tyre], something just didn't feel right with the car – I just had really little confidence and the pace was not there. “Of course it's a shame, because I really believed in it. But today was at the end P2, it’s the maximum that we could have done.” Having conceded that he did not feel totally at ease behind the wheel of the W17 during the event at Zandvoort, Antonelli acknowledged that it was “for sure”
      reporting:article:53383e5ca8   Russell offers verdict on Mercedes team orders in Dutch GP (f1com, 2026-08-23T16:53) https://www.formula1.com/en/latest/article/you-want-to-fight-for-every-single-position-russell-offers-verdict-on-mercedes-team-orders-in-dutch-gp.3qBtPSF2Jgfyu63IKV8our
      > George RussellKimi AntonelliMercedesShow more tags‘You want to fight for every single position’ – Russell offers verdict on Mercedes team orders in Dutch GPGeorge Russell has shared his thoughts after he opted to let Kimi Antonelli pass on the final laps of the Dutch Grand Prix. Aug 23, 2026 4:53pm UTCGeorge Russell has accepted that Mercedes’ call for him to pull aside and allow team mate Kimi Antonelli through was “the right decision”, even though it left him at the mercy of Ferrari’s Lewis Hamilton in the closing stages of the Dutch Grand Prix. It was a tricky race day for the Silver Arrows as neither driver seemed to be comfortable with their cars, which was especially true for Russell, who lost a position to Antonelli on the opening lap before dropping behind Oscar Piastri at the restart. He then ended up in a tight battle for P4 with the Ferrari pair of Charles Leclerc and Lewis Hamilton, which only came to an end when Russell dived into the pits. Further stops resulted in him surging back into his original position of P2, with Antonelli rapidly closing up. By that point, eventual winner Lando Norris was too far ahead to catch, but Mercedes still requested that Russell let the Italian past – something that went directly against his earlier suggestion that they “think about working as a team” to guarantee a double podium finish. Russell came under immense pressure from Hamilton over the final lapsHe nevertheless obeyed and later admitted: “Kimi was ahead of me anyway so he deserved to finish ahead. Of course when you’re in the race, you want to fight for every single position. “With the pace with the new tyre, he would’ve overtaken me anyway so it was the right decision. Just happy to be standing on the podium. It’s been a little while for me. It’s been a strong we
      reporting:article:d1debbce94   Hamilton explains frustrated radio messages in Dutch GP (f1com, 2026-08-23T17:45) https://www.formula1.com/en/latest/article/i-want-to-win-hamilton-explains-frustrated-radio-messages-in-dutch-grand-prix.4mMvpLPKV7T2kfnkITCYuO
      > Lewis HamiltonFerrariNetherlandsShow more tags‘I want to win’ – Hamilton explains frustrated radio messages in Dutch Grand PrixLewis Hamilton was heard voicing his frustrations during the Dutch Grand Prix, a race in which he just missed out on a podium in fourth place. Aug 23, 2026 5:45pm UTCLewis Hamilton has explained the emotions behind his radio messages during the middle phase of the Dutch Grand Prix, with the seven-time World Champion voicing his frustration after spending several laps stuck behind the sister Ferrari of Charles Leclerc. Hamilton was hot on the tail of the other Scuderia car by Lap 43 of the 72-lap event and felt that he had more pace – but Leclerc seemed reluctant to let his team mate by, and also opted against a call to pit. Leclerc dived into the pits one lap later which released Hamilton, but the Briton made his displeasure about the situation clear as he sarcastically radioed in: “Great waste of time there, guys.” Hamilton also sounded disgruntled later in the race when asking the team if he would be pitting under a Virtual Safety Car phase, having commented, “Are you using me as a guinea pig?”, before the team called him in to pit. He went on to cross the line in fourth, despite chasing Mercedes’ George Russell for the final spot on the podium until the chequered flag. Speaking after the Grand Prix, Hamilton was asked if his radio messages showed just how competitive the field is at the moment, with good results hanging on such decisions – leading him to draw comparison to the situation at the Silver Arrows, who opted to swap Russell and Kimi Antonelli during the closing stages. “Yeah, I want to win,” he explained. “I'm here to win, and it is difficult when you see… when you're looking ahead and you see the two Mercedes drivers, they get the 
      reporting:article:9cae91e0b5   Sainz accepts blame for unfortunate contact with Albon (f1com, 2026-08-23T17:56) https://www.formula1.com/en/latest/article/sainz-accepts-blame-for-unfortunate-contact-with-albon-in-dutch-grand-prix.7h2yrHOeTXfsakoxWJTqFB
      > Carlos SainzAlex AlbonWilliamsShow more tagsSainz accepts blame for unfortunate contact with Albon in Dutch Grand PrixCarlos Sainz holds himself responsible for the contact that forced his Williams team mate to retire from the Dutch Grand Prix. Aug 23, 2026 5:56pm UTCCarlos Sainz has reflected on the error that saw him tangle with his Williams team mate Alex Albon late in the Dutch Grand Prix, with the Spaniard conceding that it was “the last thing you want to do”. Days after the much-needed boost of Sainz and Albon committing to the Grove-based outfit for 2027, Williams endured another disheartening weekend in Zandvoort as they failed to score points for a sixth consecutive round. However, that wasn’t always a foregone conclusion – Albon battled his way into top-10 contention before an unsuccessful strategy call and contact with Sainz, which came when the latter locked up and dragged the other car with him, led to his retirement. Summarising how he felt after causing the incident, Sainz said: “We’ve been scrapping for P15/P16 all weekend. The situation in the race put Alex on a fresher medium behind. I was struggling a lot already with my hard tyres towards the end of the race. The clash resulted in Albon's retirement from the Dutch Grand Prix“All of a sudden when I went to defend, a big bump in the braking into Turn 1 surprised me. I triggered a massive front lock and with that one thing, obviously I took Alex with me, which is the last thing you want to do with a team mate. “Honestly, I was caught off guard with that big bump there and the braking and triggered a massive front lock that I couldn’t recover later. Apologies for that, and we will move on as a team. I think it’s just not there, the position that we want to be.” He went on to declare that they never had e
      reporting:article:d2fdcad2fb   Wolff explains Mercedes’ decision to invert cars in Dutch GP (f1com, 2026-08-23T18:34) https://www.formula1.com/en/latest/article/the-logical-consequence-wolff-explains-mercedes-decision-to-invert-cars-in-dutch-grand-prix.26VGrypPUwwLaL0mBocjmF
      > Toto WolffKimi AntonelliGeorge RussellShow more tags‘The logical consequence’ – Wolff explains Mercedes’ decision to invert cars in Dutch Grand PrixMercedes Team Principal Toto Wolff has shared an insight into Mercedes' decision to switch Kimi Antonelli and George Russell during the closing stages of the Dutch Grand Prix. Aug 23, 2026 6:34pm UTCToto Wolff has explained Mercedes’ call to invert their cars during the latter stages of the Dutch Grand Prix, with George Russell asked to allow Kimi Antonelli through into second place. Antonelli had been running in P2 behind McLaren’s Lando Norris when a Virtual Safety Car was called in the final phase of the race, and the Italian was amongst those to take the opportunity to pit for fresher tyres. This brought him back out on track in third – behind Norris and Russell, both of whom had opted to stay out during the VSC. On Lap 65 of 72, Mercedes informed Russell that they would switch the cars, a request that was initially met with a disgruntled response from Russell. The Briton followed the order and allowed Antonelli through, but voiced his concern that the team might have “lost a double podium” as the Ferrari pair of Lewis Hamilton and Charles Leclerc rapidly closed in. As it was, Russell managed to keep both of the Scuderia’s cars at bay and finish in P3, with Antonelli retaining second place. Quizzed on the thinking about the strategy call after the race, Wolff told F1 TV: “I think this is the policy that we always have, and we discussed it many times and also in the morning. We're not losing time with each other and having Ferraris breathing down our neck. Mercedes chose to invert Antonelli and Russell during the Dutch Grand Prix“Especially before the inverting, Kimi was ahead – he didn't need to pit, so George ended wher
      reporting:article:0993917dca   What the teams said – Race day in the Netherlands (f1com, 2026-08-23T18:41) https://www.formula1.com/en/latest/article/what-the-teams-said-race-day-in-the-netherlands-2026.1GTy1x6hObFlkGkaXKqhNS
      > MercedesMcLarenWilliamsShow more tagsWhat the teams said – Race day in the Netherlands The drivers and teams report back on all the action from the final Dutch Grand Prix at Zandvoort. Aug 23, 2026 6:41pm UTCSpecial ContributorBecky HartMcLaren Norris followed his Hungary victory with success at Zandvoort, to reignite his Championship charge. Despite losing out to Antonelli at the second standing start, Norris kept close to the Italian and really closed him down in the second stints. That was when he pulled off a brilliant move to take the race lead and, from there, never looked in danger of being passed. Despite not stopping under the late VSC and thus being on older tyres than his rival, Norris was able to pull away to win by over 11 seconds. As for Piastri, he too pulled off an incredible move – his was on Russell, to run third. But his race was undone by a slow pit stop, which dropped him behind the Mercedes. From there, he started to struggle for grip and was passed by both Ferraris to come home a distant sixth. Lando Norris, 1st "I'm incredibly happy to take the win at the final race here in Zandvoort, but it was a real fight. For the first half of the race, especially on the Soft tyre, I honestly didn't think a win was possible. I struggled a lot with the pace and balance, and it felt like a bit of a repeat of Saturday's struggles. However, once we put the Hard tyres on, the car came alive. I felt much more comfortable, I could push, and we were able to put Mercedes under pressure, forcing them into an early stop which ultimately opened the door for us. "The team's strategy was perfect, and that gave me the opportunity on fresh tyres to attack while Kimi was battling with Lewis. I knew that was my one and only chance, and I had to make it stick. Committing to the
      reporting:article:8c53e32ca8   All the key moments from the 2026 Dutch Grand Prix (f1com, 2026-08-23T19:23) https://www.formula1.com/en/latest/article/zandvoort-lowdown-all-the-key-moments-as-norris-wins-again-and-verstappen-suffers-dramatic-home-exit.7ixG14EpkWpHk28GCH7lKC
      > Netherlands2026ZANDVOORT LOWDOWN: All the key moments as Norris wins again and Verstappen suffers dramatic home exitThere were plenty of big moments during Zandvoort’s final Dutch Grand Prix, an event won by McLaren’s Lando Norris. Aug 23, 2026 7:23pm UTCThe final Dutch Grand Prix certainly delivered a memorable event, with Lando Norris taking the spoils in a dramatic race on Sunday. There were many other talking points that emerged during an action-packed weekend at Zandvoort, however, from Mercedes’ “risky” strategy en route to a double podium, through to Max Verstappen’s heavy crash and the performances of the super-subs. Here are all the key moments from the 2026 Dutch Grand Prix… Norris makes it back-to-back Grand Prix wins Lando Norris ended the first half of the 2026 season with his maiden win of the campaign, leaving him hopeful that he and McLaren could continue to deliver on that promise when the championship resumed. While he had to settle for third in Saturday’s Sprint, the reigning World Champion stormed to pole position for the Grand Prix later in the day – but with heavy rain falling prior to Sunday’s race, there were suddenly doubts over how strategies might unfold. As it was, the showers had eased by the time of lights out and Norris initially held onto P1 off the line – yet he was faced with the challenge of maintaining that position for a second time when the race was restarted following a crash for Max Verstappen (more on which below). This time around it was Antonelli who got the stronger launch, the Italian snatching the lead from Norris. The Briton bided his time, though, and managed to catch the championship leader during the final third of the race where he soon retook the place. Despite questioning whether he should have made a pit stop during 

## Sentiment and live moments (tier 3; paraphrase only, attribute by name, cite as reporting:<id>; numbers in posts are NOT citable)
      reporting:bsky:3mtiof7dmgc23     07:01 Chris Medland: BREAKING: Max Verstappen extends his contract with Red Bull until the end of 2030 #F1
      reporting:bsky:3mtix2kxrwk23     09:36 Chris Medland: Yuki in his Racing Bulls threads for this weekend “This wind is killing me!” #F1 #DutchGP
      reporting:bsky:3mtizfzxxqs23     10:18 Chris Medland: Just a little bit of interest in Max Verstappen’s new contract at Red Bull #F1 #DutchGP
      reporting:bsky:3mtnzhynxcs2l     10:03 Chris Medland: Sprint about to get underway at Zandvoort, Sainz and Alonso already starting from the pit lane and an SLM issue for Perez has seen him pushed into the pit lane now too. Leclerc and Bearman on softs, all others on mediums
      reporting:bsky:3mtnznlzr5c2l     10:06 Chris Medland: Only change in the top 11 on the opening lap is Antonelli getting Piastri for P4. Russell with a 1.2s lead early on #F1 #DutchGP
      reporting:bsky:3mtnzpsxf322l     10:07 Chris Medland: Perez joins the race three laps in to gain data, while Hulkenberg seems to have an issue and has dropped to 20th #F1 #DutchGP
      reporting:bsky:3mtnzuc2id22l     10:09 Chris Medland: Mega drone shot from Turn 3 showing the speed the cars take through the banking and disappearing through the dunes - such a cool track #F1 #DutchGP
      reporting:bsky:3mto26yti522l     10:15 Chris Medland: Overtaking looking very difficult round here, with the top four running close together but no true passing attempts. Need the tyres to drop off to create chances Piastri, Verstappen and Hamilton all creating slightly big
      reporting:bsky:3mto2mblrb22l     10:23 Chris Medland: After a spell outside, Norris back within a second of Russell, with just over two seconds covering the top four #F1 #DutchGP
      reporting:bsky:3mto2qeb5x22l     10:25 Chris Medland: Leclerc through on Norris! Used all the power he had to get down the inside into Turn 1. Can he put more pressure on Russell than Norris could? #F1 #DutchGP
      reporting:bsky:3mto2uy5bok2l     10:28 Chris Medland: Williams tells Albon it expects some rain in the final two laps... #F1 #DutchGP
      reporting:bsky:3mto2yos6ns2l     10:30 Chris Medland: Russell so far able to keep Leclerc out of overtake range, with the gap up at 1.3s Piastri also told the rain risk is increasing with three laps to go #F1 #DutchGP
      reporting:bsky:3mto3aol4ms2l     10:34 Chris Medland: Russell wins the Sprint, just as the rain starts to fall! Leclerc P2, Norris P3, holding off Antonelli in fourth Piastri, Verstappen, Hamilton and Gasly the top eight #F1 #DutchGP
      reporting:bsky:3mtohlcplhs26     14:15 Chris Medland: Drop zone ahead of the final Q1 runs: Bortoleto Bearman Ocon Bottas Perez Stroll #F1 #DutchGP
      reporting:bsky:3mtohwezrqc26     14:21 Chris Medland: OUT in Q1: Sainz +0.022s from advancing Alonso +0.098 Stroll +0.266 Bearman +0.274 Bottas +0.819 Perez +1.048 #F1 #DutchGP
      reporting:bsky:3mtoj3hfim226     14:42 Chris Medland: OUT in Q2: Gasly +0.091s from Q3 Tsunoda +0.102 Hulkenberg +0.272 Colapinto +0.275 Ocon +0.612 Albon +0.657 #F1 #DutchGP
      reporting:bsky:3mtojhfablc26     14:49 Chris Medland: Q3 is go. The McLaren pair were quickest in Q2 ahead of Verstappen, Leclerc and Antonelli #F1 #DutchGP
      reporting:bsky:3mtojje3b5c26     14:50 Chris Medland: And now the chance of rain is increasing - Mercedes saying it looks like it will hit in the last five minutes so these first laps could be the key ones #F1 #DutchGP
      reporting:bsky:3mtojpis6nc26     14:53 Chris Medland: Provisional pole for Norris after the first runs Norris Russell +0.151s Piastri +0.233 Leclerc +0.323 Antonelli +0.331 Verstappen +0.333 Lawson +0.467 Hamilton +0.766 Lindblad +1.029 Bortoleto +1.686 #F1 #DutchGP
      reporting:bsky:3mtojs4j75s26     14:55 Chris Medland: Russell trying to find a way past Norris on the out lap, properly pushing him, as splashes of rain are clear on the cameras #F1 #DutchGP
      reporting:bsky:3mtok2vnou226     14:59 Chris Medland: It's pole for Lando Norris! Beats Russell by 0.102s, with Antonelli another 0.031s back in third Piastri, Hamilton, Leclerc, Verstappen, Lawson, Bortoleto and Lindblad the top ten #F1 #DutchGP
      reporting:x:2091499129092375005  12:13 Adam Cooper: 10 mins before the cars go to the grid and it's raining in Zandvoort. Tents going up: https://t.co/7uhhWrDrQD
      reporting:x:2091499184968892549  12:13 Ronald Vording: Ook Charles is klaar voor de laatste... #F1 #DutchGP (Moet alleen nog even naar de auto aan de andere kant van de garage) https://t.co/OQREL1T9UY
      reporting:x:2091499817105043801  12:16 Chris Medland: 45 minutes to go until lights out and the rain has started falling. Radar looks like quite a strong shower up until 15 minutes before the race starts #F1 #DutchGP
      reporting:x:2091500442849006075  12:18 Adam Cooper: Track is now properly damp...: https://t.co/ijQDaHVjZV
      reporting:x:2091500783929798805  12:20 Erik van Haren: Een onverwachte bui boven Zandvoort, zo’n drie kwartier voor de start van de laatste Grand Prix van Nederland. ☔️ https://t.co/2YQBqBNgke
      reporting:x:2091502755617620275  12:28 Adam Cooper: Drivers on inters for the laps to the grid but it still might be slicks for the start: https://t.co/91LIj81s1N
      reporting:x:2091505328466620441  12:38 Luke Smith: Rain has now stopped on the grid but we had a decent drizzle for 25-30 mins or so. Hopefully makes for an exciting start 🤞
      reporting:x:2091505605835936111  12:39 Chris Medland: Still a few showers off the coast but nothing more that looks likely to hit the track before the start, or for the opening laps of the race at least #F1 #DutchGP
      reporting:x:2091505639843332349  12:39 Luke Smith: Gazebos are coming down https://t.co/5bqISQTKma
      reporting:x:2091509118360035420  12:53 Luke Smith: Always a good grid ceremony at Zandvoort 🇳🇱 interested to see what tyres are taken for the start! https://t.co/zulZqO3aIi
      reporting:x:2091509190581731370  12:53 Ronald Vording: One last time... #F1 #DutchGP https://t.co/gm01rC5DmY
      reporting:x:2091510013810393568  12:57 Erik van Haren: Kans op regen tijdens race lijkt klein. Inmiddels ook alweer eventjes droog. Prachtige show voorafgaan aan laatste race in Zandvoort. #F1 https://t.co/kDU7MrW3Ur
      reporting:x:2091510131922014275  12:57 Luke Smith: Despite the rain, all cars are starting on slicks #F1 #DutchGP
      reporting:x:2091510297093693789  12:58 Erik van Haren: Top-4 start op medium. Daarachter rest van top-10, inclusief Verstappen, op softs. O.a. Hamilton en Verstappen op nieuwe set. #F1
      reporting:x:2091510356560474546  12:58 Luke Smith: There will be one lap behind the safety car before a standing start, according to the FIA #F1 #DutchGP
      reporting:x:2091510683472994732  12:59 Chris Medland: FIA: "The field will do one lap behind the Safety Car before assembling for a standing start" #F1 #DutchGP
      reporting:x:2091511282667049263  13:02 Luke Smith: Turn 13 is the wettest part of the track. Norris reports on the radio that the track is fine. All confirmed for a standing start #F1 #DutchGP
      reporting:x:2091511626474107273  13:03 Chris Medland: Top four all on mediums, as well Gasly, Colapinto and Ocon. Cadillacs on hards, rest on softs #F1 #DutchGP
      reporting:x:2091511967991099538  13:04 Chris Medland: Bad getaway for Russell and he loses a place to Antonelli. Norris leads, Leclerc takes P4 from Piastri and Hamilton drops to sixth ahead of the Red Bulls #F1 #DutchGP
      reporting:x:2091512005236564097  13:04 Luke Smith: We're away in Zandvoort - poor start by George Russell drops him behind Kimi Antonelli, Lando Norris keeps his lead for McLaren. Leclerc up two spots to 4th #F1 #DutchGP
      reporting:x:2091512130071667183  13:05 Chris Medland: Huge crash for Verstappen at the final corner! #F1 #DutchGP
      reporting:x:2091512273214853411  13:05 Chris Medland: Red flag #F1 #DutchGP https://t.co/kP5TifDa2z
      reporting:x:2091512354982777207  13:06 Erik van Haren: Wat een ongelooflijk dramajaar is dit toch eigenlijk voor Verstappen. Hij crasht in de laatste bocht. Zijn laatste Grand Prix van Nederland zit er al na één ronde op. Rode vlag. #F1
      reporting:x:2091512392018477356  13:06 Luke Smith: RED FLAG - Verstappen crashes at the final corner, lost it all on his own and puts it into the wall. Lots of debris. 📻 Verstappen: "That's it. Ahhh fuck's sake, sorry." #F1 #DutchGP
      reporting:bsky:3mtqu6z7qkk26     13:06 Chris Medland: Red flag #F1 #DutchGP
      reporting:x:2091512742339334202  13:07 Chris Medland: Bortoleto also looked like he went round at the same corner #F1 #DutchGP
      reporting:x:2091513758812078411  13:11 Luke Smith: Huge shame for Verstappen at his final Zandvoort race. Should mean we get a standing restart whenever we get going again. Whole field will have the chance to change tyres, too #F1 #DutchGP
      reporting:x:2091514026467471541  13:12 Chris Medland: It's damp on that part of the track, and Verstappen lost the rear at the bottom of the banking. He tried to catch it but overcorrected and slammed into the outside barrier #F1 #DutchGP
      reporting:x:2091514285713158164  13:13 Chris Medland: Verstappen climbed out of the car himself and said he was OK, but it was a really big hit and it automatically deployed the medical car #F1 #DutchGP
      reporting:x:2091515040394285145  13:16 Chris Medland: It's only a small shower and could change before it arrives, but the radar shows one that would hit in about 25/30 minutes #F1 #DutchGP
      reporting:x:2091515189006909915  13:17 Luke Smith: Jeez, that Hulkenberg onboard with the Bortoleto spin 😳 📻 Hulkenberg: "That was crazy with Gabi. I almost T-boned him." #F1 #DutchGP
      reporting:x:2091515849647513968  13:20 Luke Smith: Esteban Ocon has been noted for a yellow flag infringement - going to presume that's the overtake on Albon that the Williams driver was unhappy about. Surely the stewards take a look next #F1 #DutchGP
      reporting:x:2091516045789888921  13:20 Erik van Haren: Onderweg naar de grid, in aanloop naar de race, zei Verstappen al dat het nog 'quite wet' was in de laatste bocht. #F1
      reporting:x:2091516139092213781  13:21 Luke Smith: Or not - no further investigation, per the stewards https://t.co/8Mhj4MWyNz
      reporting:x:2091516707231731902  13:23 Chris Medland: Race resumption in 10 minutes - at 15:33 local time #F1 #DutchGP
      reporting:x:2091516710931026045  13:23 Luke Smith: Race resumes at 15:33 local time in Zandvoort, so in 10 minutes #F1 #DutchGP
      reporting:x:2091518634854146308  13:31 Chris Medland: Looks like it's breaking up so I'd call this one unlikely now #F1 #DutchGP
      reporting:x:2091519536830791712  13:34 Luke Smith: McLaren has moved Norris onto softs for the restart, and has put Piastri into a set of hards! Nice to see some gambles before we get going again #F1 #DutchGP
      reporting:x:2091519800912605247  13:35 Chris Medland: Standing restart incoming. Norris has switched to soft tyres while Piastri has gone for hards. Issue at the pit exit saw a red light shown to cars near the back who had to wait, and Norris is already rolling onto the gri
      reporting:x:2091519882462380409  13:36 Luke Smith: Stroll hit a red light at pit exit and waited there which led to the split. "So everybody who went under red should get a penalty, stop and go. It's the rules." #F1 #DutchGP
      reporting:x:2091520040084406686  13:36 Chris Medland: Got to be another formation lap, we still have plenty of cars approaching the grid. Cars are out of position #F1 #DutchGP
      reporting:x:2091520601793929434  13:39 Chris Medland: The FIA says Bearman's car wasn't safe by the time the race needed to start, as the main reason for the extra formation lap #F1 #DutchGP
      reporting:x:2091520962302751147  13:40 Luke Smith: We're back racing at Zandvoort and Kimi Antonelli leads! Gets the better start on Norris and finds a way up the inside. Russell back to P4 behind Piastri #F1 #DutchGP
      reporting:x:2091521077503512623  13:40 Chris Medland: Antonelli takes the lead from Norris off the line! And then Piastri gets Russell at Turn 7 for P3! #F1 #DutchGP
      reporting:x:2091521808822374633  13:43 Luke Smith: Looking at the onboards, the light turned from green to red just before Bearman went through pit exit. Bortoleto followed. Stroll then stopped at the light at the end of the pit lane #F1 #DutchGP https://t.co/VElgLZ4WM0
      reporting:x:2091522317905977477  13:45 Chris Medland: Norris told there might be a sprinkling of rain again soon Colapinto and Lindblad have both had drive-through penalties for overtaking under yellows when Verstappen crashed #F1 #DutchGP
      reporting:x:2091522670974075162  13:47 Chris Medland: Stroll was the first car that stopped for the pit lane red light, and Bortoleto has been noted for not stopping (Bearman too but he's out of the race) #F1 #DutchGP https://t.co/z8zWFdEJnq
      reporting:x:2091522673469804961  13:47 Luke Smith: Now noted by the stewards for leaving pit exit on a red light https://t.co/eUcZugn1xJ
      reporting:x:2091523454499520750  13:50 Luke Smith: The incidents with Bortoleto and Bearman will be investigated after the race. https://t.co/UpjgschOjY
      reporting:x:2091524612714623180  13:55 Chris Medland: Antonelli (on mediums) two seconds clear of Norris (on softs) now, with Piastri 4.7s back (on hards) Russell holding off the Ferraris for now, but he's dropped over two seconds off Piastri #F1 #DutchGP
      reporting:x:2091525227578540115  13:57 Chris Medland: Russell pits for hards but emerges into traffic in P9 #F1 #DutchGP
      reporting:x:2091525631095787901  13:59 Chris Medland: Oh McLaren... Piastri is called in to cover (with a decent gap) but a slow right rear costs him and he emerges behind Russell #F1 #DutchGP
      reporting:x:2091525734938333232  13:59 Luke Smith: Russell undercuts Piastri for net 3rd! A slow stop for Piastri costs him the position as he emerges behind Russell #F1 #DutchGP
      reporting:x:2091526538449596791  14:02 Chris Medland: Antonelli's called into the pits and Norris is in at the same time. Busy pit lane with Leclerc and Lawson in too, as Hamilton stays out to lead #F1 #DutchGP
      reporting:x:2091528795450724363  14:11 Chris Medland: Great midfield fighting triggered by Sainz and Lindblad who are yet to pit, with quicker cars on fresh tyres coming through. Hulkenberg takes advantage, and now Tsunoda with a brilliant pass on Gasly at Turn 7 as well! #
      reporting:x:2091529203585839377  14:13 Chris Medland: Norris back within a second of Antonelli at the front right now, while Leclerc is putting pressure on Piastri for P4 Hamilton the fastest lap in P6, just under six seconds back after running long in the first stint #F1 #
      reporting:x:2091530137518887279  14:16 Chris Medland: Tsunoda released from behind Lindblad too (who is out of sequence after his penalty) and Lindblad holding up Gasly has created a gap there of nearly four seconds for what is a net P9 #F1 #DutchGP
      reporting:x:2091530574292771022  14:18 Chris Medland: Norris really pushing Antonelli now, but then a moment at the penultimate corner costs him nearly a second Spots of rain on Leclerc's camera there... But he attacks Piastri and is through at Turn 3! Hamilton attacking Pi
      reporting:x:2091530930745639057  14:20 Chris Medland: And Hamilton is through! Down the inside of Piastri at Turn 1. Leclerc attacked on the outside of Turn 1, then switched back on the exit and got the move finished around the outside of Turn 3 #F1 #DutchGP
      reporting:x:2091531567516577844  14:22 Chris Medland: Leclerc now two seconds off the back of Russell for P3 - medium tyres for Leclerc against Russell's hards. Norris back within a second of Antonelli through traffic #F1 #DutchGP
      reporting:x:2091532050733900259  14:24 Chris Medland: Alonso gets Albon for P11 - he's having a great race and is now nine seconds off the points but just made a stop so has fresh tyres #F1 #DutchGP
      reporting:x:2091532308515885307  14:25 Chris Medland: Leclerc within a second of Russell, and Hamilton just 1.7s behind. The Ferraris looking strong right now, albeit ten seconds off the lead #F1 #DutchGP
      reporting:x:2091532493543407946  14:26 Luke Smith: Norris has closed up on Antonelli again after losing a bit of time with that snap at the final corner, gap is under a second — and now Antonelli pits! #F1 #DutchGP
      reporting:x:2091532938089296164  14:28 Chris Medland: Antonelli pits with Norris close behind him. Decent stop, and that should prevent Norris jumping him in the pits. Russell also in, releasing the two Ferrari drivers who are line astern at the moment #F1 #DutchGP
      reporting:x:2091533291027341710  14:29 Chris Medland: Norris stays out - no point pitting in reaction there as he would have come about behind, so he's after an offset. Hamilton says he's quicker than Leclerc on better tyres, Leclerc gets told to box but pushes back on the 
      reporting:x:2091533728199606299  14:31 Luke Smith: 📻 Hamilton: "Great way of wasting time, guys. Great job." #F1 #DutchGP
      reporting:x:2091533938678239550  14:32 Chris Medland: Leclerc pits a lap later than he had originally been told, slightly slow stop too and he's now seven seconds behind Russell. Hamilton sarcastically says: "Great way of wasting time guys, good job" #F1 #DutchGP
      reporting:x:2091534405458067501  14:33 Chris Medland: Antonelli on the hards: "Bono, I've got no grip" Norris still creating an offset in the lead, and Hamilton also able to go much longer in P2 #F1 #DutchGP
      reporting:x:2091534956774215754  14:36 Luke Smith: Lando Norris pits from the lead and is back out on a fresh set of hards. He's got 5 seconds to make up to Antonelli, but will have a 7-lap tyre delta. Game on! #F1 #DutchGP
      reporting:x:2091535072729903438  14:36 Chris Medland: Norris pits for a new set of hards, and now he sets off after Antonelli. Gap is six seconds. What could help, is Hamilton's pace in the lead is decent, and he could end up holding Antonelli up for a few laps too #F1 #Dut
      reporting:x:2091535435742802014  14:38 Craig Scarborough: Looking forward to the hi res photos after the race! #Dutchgp #F1 #F1tech https://t.co/qDcRvAnDd3
      reporting:x:2091535467338477915  14:38 Chris Medland: Norris is reeling Antonelli in already. Gap down to three seconds #F1 #DutchGP
      reporting:x:2091535584825122999  14:38 Luke Smith: Norris takes 1.5s out of Antonelli on the first lap alone... https://t.co/vtKZDxkKZs
      reporting:x:2091535880640991689  14:39 Chris Medland: More than a second taken out of Antonelli again on the next lap. Norris will get to Antonelli before Antonelli gets to Hamilton #F1 #DutchGP
      reporting:x:2091536178902090033  14:40 Chris Medland: Norris might drive straight past Antonelli here! He's absolutely cruised up to the back of him #F1 #DutchGP
      reporting:x:2091536632163815633  14:42 Chris Medland: Hamilton actually helps Antonelli as Antonelli gets overtake mode and can defend on the pit straight. Norris swarming all over the Mercedes #F1 #DutchGP
      reporting:x:2091536784123429053  14:43 Luke Smith: Lando Norris, take a bow - some move to pass Antonelli!! #F1 #DutchGP
      reporting:x:2091537186046755002  14:44 Chris Medland: Norris around the outside of Antonelli at Turn 1! Brilliantly done as Antonelli had a bit of a look at Hamilton Norris gets Hamilton before Turn 11 after Hamilton ran wide #F1 #DutchGP
      reporting:x:2091537353953177956  14:45 Chris Medland: VSC for Ocon stopped on track! Hamilton can pit here and maybe keep P3. Will be very close... #F1 #DutchGP
      reporting:x:2091537545918046577  14:46 Luke Smith: 📻 Hamilton: "Are you using me as a guinea pig or what? What's going on? How long will you have me stay out?" Hamilton now pits under the VSC for a set of softs to get to the end of the race, cheaper stop #F1 #DutchGP
      reporting:x:2091537835211837707  14:47 Chris Medland: Sorry, I was miles off about P3, but Leclerc also pits, and so does Piastri. So Hamilton is P4 on softs, and was very quick #F1 #DutchGP
      reporting:x:2091538116247011381  14:48 Chris Medland: Antonelli pits too! He just emerges ahead of Hamilton, but that's Russell up to P2. Antonelli wanted to get off the hards, so he's on softs now #F1 #DutchGP
      reporting:bsky:3mtqzxn5q3s2z     14:49 Chris Medland: Norris can't respond so his lead over Antonelli is 12s with 15 laps to go #F1 #DutchGP
      reporting:x:2091538438159737095  14:49 Chris Medland: Norris can't respond as the race restarts so his lead over Antonelli is 12s with 15 laps to go #F1 #DutchGP
      reporting:x:2091539128814883016  14:52 Chris Medland: Early stages since restarting but Norris for now looks plenty quick enough to stop Antonelli closing that gap in time #F1 #DutchGP
      reporting:x:2091539368976515323  14:53 Chris Medland: Gasly gets Tsunoda for P10, and he now has to chase Alonso who is up in ninth and on for points for Aston Martin here #F1 #DutchGP
      reporting:x:2091539701752545293  14:54 Chris Medland: Antonelli is going to catch Russell in these final 10 laps... How do Mercedes play this? #F1 #DutchGP
      reporting:x:2091540781798457502  14:59 Chris Medland: The answer: Team orders for Russell to let Antonelli through at Turn 1 #F1 #DutchGP https://t.co/GClaDE0D4i
      reporting:x:2091541191514866103  15:00 Chris Medland: Six laps to go and Russell pushed back asking if Antonelli's fighting for the win, but he obliges and Antonelli is through. Russell warns that could cost a double podium, as Hamilton is right there #F1 #DutchGP
      reporting:x:2091541851455009053  15:03 Chris Medland: Russell's going to be angry here, because Antonelli is not fighting for the win and has now pulled away to leave Russell vulnerable from from Hamilton Had Mercedes told Antonelli to stay close then Russell could have had
      reporting:x:2091542100890279982  15:04 Chris Medland: Lots of debris on track with three laps to go #F1 #DutchGP
      reporting:x:2091542375856287768  15:05 Chris Medland: VSC to clear it up - it was the Williams drivers colliding at Turn 1 and then debris falling off later #F1 #DutchGP
      reporting:x:2091542550498722225  15:06 Chris Medland: That VSC might just have saved Russell's third place. Hamilton was right on his gearbox as it came out #F1 #DutchGP
      reporting:x:2091543066381291891  15:08 Luke Smith: Lando Norris WINS the Dutch Grand Prix for McLaren! 🏆 Emphatic win, great pass on Antonelli to clinch it, very well deserved. Tees McLaren up for a strong second half of the season 👀 #F1 #DutchGP
      reporting:x:2091543359949099272  15:09 Chris Medland: Lando Norris wins the Dutch Grand Prix! Kimi Antonelli is second and George Russell holds on for third place Hamilton and Leclerc right behind Russell, then Piastri, Lawson, Hulkenberg, Alonso and Gasly #F1 #DutchGP
      reporting:x:2091543419877224790  15:09 Jon Noble: #DutchGP Result: 1 Norris; 2 Antonelli; 3 Russell; 4 Hamilton; 5 Leclerc; 6 Piastri; 7 Lawson; 8 Hulkenberg; 9 Alonso; 10 Gasly. #F1
      reporting:x:2091543613331198265  15:10 Chris Medland: Back-to-back wins for Norris, and the first non-Mercedes driver to win multiple races this season "The fight's still on, let's keep going" he says on radio #F1 #DutchGP
      reporting:x:2091543695141052521  15:10 Erik van Haren: Lando Norris wint een leuke, laatste race in Zandvoort. Hij verloor leiding bij herstart, maar was uiteindelijk duidelijk het snelst vandaag. Daarachter Antonelli en Russell naar P2 en P3, vóór de Ferrari's. Liam Lawson 
      reporting:x:2091545755878080849  15:19 Erik van Haren: Norris nu vierde in WK-stand. Achterstand op leider Antonelli: 83 punten. Nog 11 races te gaan. Vorig jaar was kloof Verstappen met toenmalige WK-leider Piastri na race in Zandvoort liefst 104 punten. #F1
      reporting:x:2091547403035791455  15:25 Erik van Haren: Verstappen over zijn crash: "Een vrij harde klap, maar ik heb ze wel erger gehad. Het was nog nat op dat gedeelte van het circuit. Ik dacht dat ik alsnog kon versnellen, maar dat was te vroeg." #F1
      reporting:x:2091551994364198915  15:43 Andrew Benson: Dutch Grand Prix: Lando Norris beats Kimi Antonelli at final Zandvoort race - BBC Sport https://t.co/eEWgMXgHsB
      reporting:x:2091562856831386066  16:26 Craig Scarborough: A safety feature that is new in these regulations, is that the nose needs to be formed of two crash structures. The first sacrificial section can be damaged, but still leave a section of crash structure behind. #F1 #F1te
      reporting:x:2091580004316377290  17:35 Erik van Haren: Koning Willem-Alexander geniet ondanks sof Max Verstappen van laatste Dutch Grand Prix: ’Ik draag de hele Formule 1 een warm hart toe’ https://t.co/X8maMexEAG
      reporting:x:2091582324274078114  17:44 Adam Cooper: '@HulkHulkenberg on the near miss with spinning team mate @gabortoleto85...: "A bit wild. The whole track was very dry, just that corner stayed much wetter, and obviously sketchy, caught people out. It was very tricky, a
      reporting:x:2091582951943266366  17:46 Luke Smith: Lewis Hamilton explains his radio frustration over Ferrari's strategy at Zandvoort: "I want to win." https://t.co/hj698gNREP
      reporting:x:2091588879669211618  18:10 Adam Cooper: A lot to take on board today after an entertaining afternoon at Zandvoort, and a great race at the front. The best news of course is that @Max33Verstappen escaped unhurt from a huge impact, and that everyone else avoided
      reporting:x:2091594525516911056  18:32 Luke Smith: Got questions following the Dutch GP? Send them in for our next mailbag on @TheAthletic 📬 https://t.co/2rGh2CRrBH
      reporting:x:2091595337534226529  18:36 Andrew Benson: Toto Wolff says Mercedes 'haven't got the money' to develop car at same pace as rivals - BBC Sport https://t.co/wMSvRxPkUo
      reporting:x:2091597022046433434  18:42 Adam Cooper: '@Max33Verstappen on his first lap crash: "I got caught out. It was still quite wet in that corner. And then as soon as I saw the dry patch coming, I said now you can accelerate - but clearly that didn't work. So probabl
      reporting:x:2091613368498921936  19:47 Albert Fabrega: Las FABRENOTAS del GP de Paises Bajos en Zandvoort https://t.co/JeglqV7uOj
      reporting:x:2091615379147624476  19:55 Andrew Benson: Lewis Hamilton says Ferrari's delay in moving Charles Leclerc out of way was costly - BBC Sport https://t.co/3lR49GHbhH
      reporting:x:2091616256474423560  19:59 Andrew Benson: Norris and McLaren 'don't have car' to fight for title - BBC Sport https://t.co/jFQIE2TDLB
      reporting:x:2091617281851666679  20:03 Adam Cooper: That's all folks - the end of the road for Zandvoort and F1 after a history that stretches back to the first non-championship Dutch GP in 1950. It's been fun..: https://t.co/CtXIe6dsNg
      reporting:bsky:3mu2phll6fc2x     11:08 Chris Medland: Alpine confirms Franco Colapinto is staying with the team as part of an unchanged driver line-up in 2027 #F1
      reporting:bsky:3mu7kkarnqc2w     09:23 Chris Medland: Lando Norris is staying at McLaren long-term, signing a new contract until at least the end of 2030, with multi-year options beyond that #F1
      reporting:bsky:3muk3wggrr22z     14:01 Chris Medland: Red Bull confirms Liam Lawson will still drive for the team in Monza, with Isack Hadjar still recovering "The team is closely monitoring his rehabilitation and will take no unnecessary risks with his return to competitio
      reporting:bsky:3muorolev6s2e     10:41 Chris Medland: FP1 might be underway in Monza, but we've just had confirmation from the International Court of Appeal that Pierre Gasly's time penalties in Monaco have been reinstated, giving Isack Hadjar his podium back McLaren and Re
      reporting:bsky:3muos6nu6f22e     10:50 Chris Medland: VSC in FP1 as Herta pulls over in the Cadillac between the two Lesmos. He was told to stop by the team, but the car appears stuck in gear so now a red flag #F1 #ItalianGP
      reporting:bsky:3muoukr5ojk2e     11:32 Chris Medland: FP1 result at Monza: Leclerc - 1:23.008 Hamilton +0.173s Russell +0.304 Lawson +0.425 Antonelli +0.636 Norris +0.711 Lindblad +0.794 Bortoleto +0.998 Colapinto +1.020 Aron +1.169 #F1 #ItalianGP
      reporting:bsky:3mupacg52vk2e     15:03 Chris Medland: FP2 at Monza: Russell - 1:22.559 Leclerc +0.120s Antonelli +0.141 Norris +0.384 Hamilton +0.457 Piastri +0.469 Lindblad +0.790 Bearman +0.811 Verstappen +0.818 Tsunoda +0.896 #F1 #ItalianGP
      reporting:bsky:3murf642nfc2e     11:35 Chris Medland: FP3 result from Monza: Russell - 1:22.219 Hamilton +0.226s Verstappen +0.350 Antonelli +0.361 Norris +0.406 Leclerc +0.489 Lindblad +0.505 Piastri +0.554 Gasly +0.679 Colapinto +0.882 #F1 #ItalianGP
      reporting:bsky:3murml4dk6c2e     13:48 Chris Medland: Lawson joins Antonelli and Albon with a power unit penalty as Red Bull also takes new components Expect Antonelli to help Russell and Lawson to help Verstappen with a tow in qualifying #F1 #ItalianGP
      reporting:bsky:3murogxxevk2e     14:21 Chris Medland: OUT in Q1: Tsunoda +0.139s from Q2 Albon +0.740 Bottas +0.748 Perez +0.979 Alonso +1.534 Stroll +1.606 #F1 #ItalianGP
      reporting:bsky:3murp553gfs2e     14:33 Chris Medland: Alpine looking remarkably quick so far in qualifying, with Gasly topping Q1 and up in P3 behind the two McLarens after the first runs of Q2 #F1 #ItalianGP
      reporting:bsky:3murpawtqzk2e     14:36 Chris Medland: Drop zone before the final Q2 runs: Hamilton Bearman Lawson Hulkenberg Sainz Ocon #F1 #ItalianGP
      reporting:bsky:3murplauzxk2e     14:41 Chris Medland: Hamilton is barely up on Bortoleto's time that he needs to beat to get into Q3... Only in by 0.05s for now... And Bortoleto misses out by 0.001s! That's incredible #F1 #ItalianGP
      reporting:bsky:3murpox776s2e     14:43 Chris Medland: OUT in Q2: Bortoleto +0.001s from Q3 Bearman +0.240 Hulkenberg +0.263 Lawson +0.305 Sainz +0.937 Ocon +0.938 #F1 #ItalianGP
      reporting:bsky:3murq6u743c2e     14:52 Chris Medland: OK, now Ferrari wakes up in a very close first run of Q3. Leclerc within a tenth of provisional pole, but only P4 for now: Russell - 1:21.929 Piastri +0.037s Gasly +0.072 Leclerc +0.075 Verstappen +0.141 #F1 #ItalianGP
      reporting:bsky:3murqgqnlsc2e     14:57 Chris Medland: Five teams in the mix for pole here, but it's so dependent on getting a tow at the right time and a clean rest of the lap. Genuinely couldn't call it right now #F1 #ItalianGP
      reporting:bsky:3murqkrpc6s2e     14:59 Chris Medland: Alpine heading out last, and need to be fairly quick round to the flag to start their final runs behind the Ferrari pair. McLaren going first, with Piastri set to give Norris a tow (it was the opposite order on the previ
      reporting:bsky:3murqmwlmbk2e     15:00 Chris Medland: Piastri locks up and cuts the first chicane. He doesn't keep pushing, and that means Norris now has no tow. He's 0.4s down through the first sector so it's over for both McLarens #F1 #ItalianGP
      reporting:bsky:3murqoudnoc2e     15:01 Chris Medland: Russell gets a great tow from Verstappen and improves AND THEN PIERRE GASLY TAKES POLE POSITION! #F1 #ItalianGP
      reporting:bsky:3murqvz3zms2e     15:05 Chris Medland: I'll repeat that: Pierre Gasly takes pole position for the Italian Grand Prix! Gasly - 1:21.786 Russell +0.060s Piastri +0.180 Leclerc +0.218 Hamilton +0.225 Verstappen +0.284 Antonelli +0.307 (starts from the back) Cola
      reporting:bsky:3murvgsyrwk2e     16:26 Chris Medland: PENALTY: Three-place grid penalty for Piastri for impeding Lawson in Q2 Drops him from P3 to P6, and means an all-Ferrari second row, with Verstappen starting fifth #F1 #ItalianGP
      reporting:bsky:3mutqiffwgc2u     10:03 Chris Medland: Red Bull has changed Lawson’s rear wing assembly, meaning a pit lane start today Alonso also set for a pit lane start for taking new PU components without the technical delegate’s approval #F1 #ItalianGP
      reporting:bsky:3muu2kzrpqk2c     13:03 Chris Medland: Quite a mix of starting tyres with mediums for Gasly, Russell, Piastri, Colapinto, Norris, Lindblad, Hulkenberg, Albon and Lawson Hards for Tsunoda, Antonelli and Alonso Softs for the rest #F1 #ItalianGP
      reporting:bsky:3muu2nad52c2c     13:05 Chris Medland: Gasly retains the lead at the start and Leclerc pushes Hamilton wide out of the first chicane! Verstappen up to P4, Hamilton has dropped about six places #F1 #ItalianGP
      reporting:bsky:3muu2pez22k2c     13:06 Chris Medland: Russell takes the lead from Gasly at the end of the first lap, Leclerc follows him through but Gasly takes it back at Curva Grande #F1 #ItalianGP
      reporting:bsky:3muu2qkrntk2c     13:06 Chris Medland: Huge crash for Leclerc at Parabolica! Massive off #F1 #ItalianGP
      reporting:bsky:3muu2sqaqj22c     13:08 Chris Medland: Red flag #F1 #ItalianGP
      reporting:bsky:3muu2wtayu22c     13:10 Chris Medland: Verstappen had overtaken Leclerc into Ascari, and then Piastri had a look at Parabolica but backed out of it. Leclerc then had the rear sliding out on him on the outside of the corner, and in trying to catch it was just 
      reporting:bsky:3muu2yqhgrk2c     13:11 Chris Medland: The medical team are with Leclerc who is sitting in the shade but able to get up under his own power The barrier will need repairing after that, hence the red flag #F1 #ItalianGP
      reporting:bsky:3muu3goykq22c     13:19 Chris Medland: Under the red flag, Antonelli is P12 already and very well placed for some solid points, although might have lost his advantage of starting on hards as everyone can change tyres now #F1 #ItalianGP
      reporting:bsky:3muu3kxgpjk2c     13:21 Chris Medland: The FIA says at least 15 minutes will be required to repair the barrier before a race resumption #F1 #ItalianGP
      reporting:bsky:3muu3x6lwck2c     13:28 Chris Medland: Race will resume at 15:39 local time, so in 11 minutes #F1 #ItalianGP
      reporting:bsky:3muu4irriqc2c     13:38 Chris Medland: Ferrari says Leclerc has now left the medical centre (standard after such an impact) and is OK #F1 #ItalianGP
      reporting:bsky:3muu4orpwe22c     13:41 Chris Medland: Tyres on the restart, most are on hards but Verstappen, Hamilton, Bortoleto, Antonelli, Tsunoda and Bottas are on mediums #F1 #ItalianGP
      reporting:bsky:3muu4pitdic2c     13:42 Chris Medland: It's a standing start, here we go again #F1 #ItalianGP
      reporting:bsky:3muu4rcerbc2c     13:43 Chris Medland: Extra formation lap as Tsunoda doesn't appear to be in his grid slot properly #F1 #ItalianGP
      reporting:bsky:3muu4ypcji22c     13:47 Chris Medland: GO: And Colapinto takes third from Verstappen! But Verstappen regains it, and now Hamilton is up to fifth - make that fourth as Colapinto goes wide at the first Lesmo #F1 #ItalianGP
      reporting:bsky:3muu54hgkbc2c     13:49 Chris Medland: Hamilton now passes Piastri again to move up to P4 Verstappen through on Gasly before Parabolica and he sets off after Russell #F1 #ItalianGP
      reporting:bsky:3muu56pobu22c     13:50 Chris Medland: Russell is 1.9s clear of Verstappen while Gasly has Hamilton closing in for P3 #F1 #ItalianGP
      reporting:bsky:3muu5cnd6sc2c     13:52 Chris Medland: Here comes Hamilton, round the outside of Gasly into Turn 1 on the brakes and he's up to P3, while Verstappen is also closing in a little on Russell #F1 #ItalianGP
      reporting:bsky:3muu5dve33c2c     13:53 Chris Medland: Gasly going backwards quickly right now, as Piastri and Antonelli also come through. P3 to P6 in one lap #F1 #ItalianGP
      reporting:bsky:3muu5ezkkek2c     13:54 Chris Medland: Not just a little, a lot, as Verstappen gets right onto the back of Russell in the lead #F1 #ItalianGP
      reporting:bsky:3muu5gjpun22c     13:55 Chris Medland: Verstappen takes the lead! Russell can't hold him off into Turn 1, while Piastri takes P3 behind! #F1 #ItalianGP
      reporting:bsky:3muu5hq74zk2c     13:55 Chris Medland: Antonelli follows Piastri through for P4. He's just two places behind Russell on Lap 12! #F1 #ItalianGP
      reporting:bsky:3muu5jkpg4c2c     13:56 Chris Medland: Here comes Antonelli - clears Piastri into Turn 1. He's now third and can absolutely win this race from 19th on the grid #F1 #ItalianGP
      reporting:bsky:3muu5muyabs2c     13:58 Chris Medland: Russell attacks into the first chicane but Verstappen holds him off. Norris in P7 behind Gasly is just 3.6s off the lead #F1 #ItalianGP
      reporting:bsky:3muu5pqa5rs2c     14:00 Chris Medland: Russell retakes the lead through Curva Grande, and now Antonelli attacks Verstappen for P2 #F1 #ItalianGP
      reporting:bsky:3muu5slrtrs2c     14:01 Chris Medland: Antonelli takes second from Verstappen at Curva Grande as well. Mercedes hit the front with both cars but it's still a train with lots of position swapping as Hamilton and Piastri trade P4 #F1 #ItalianGP
      reporting:bsky:3muu5ugcqfk2c     14:02 Chris Medland: Verstappen: "Yeah the car is completely broken on the rear axle" #F1 #ItalianGP
      reporting:bsky:3muu5wfk3hs2c     14:03 Chris Medland: Kimi Antonelli leads the Italian Grand Prix! Lap 18, he overtakes George Russell. Wild. #F1 #ItalianGP
      reporting:bsky:3muu5zrofws2c     14:05 Chris Medland: The top three are breaking away here, and they're so close together! Nearly three wide on the pit straight that time but they all end up in the same positions Piastri back into P4, but three seconds back at the moment #F
      reporting:bsky:3muu65g3j2s2c     14:07 Chris Medland: Russell and Antonelli trade the lead within a few corners, and have dropped Verstappen by 1.5s at the moment Gasly and Norris scrapping hard and they've dropped over three seconds back from Piastri and Hamilton #F1 #Ital
      reporting:bsky:3muu6ciu3uk2c     14:10 Chris Medland: The Mercedes pair running inches apart this time as Antonelli goes round the outside into the second chicane to regain the lead that Russell had taken on the pit straight. You sense this won't get any calmer the longer i
      reporting:bsky:3muu6g3lq2k2c     14:12 Chris Medland: Mercedes wants its drivers to stop swapping positions, but Verstappen appears able to stay in touch when they don't pass each other #F1 #ItalianGP
      reporting:bsky:3muu6m5jf4c2c     14:16 Chris Medland: Antonelli goes deep at the first chicane and cuts through the gravel. Verstappen appears comfortable enough at the moment behind both of them #F1 #ItalianGP
      reporting:bsky:3muu6r3etls2c     14:18 Chris Medland: VSC as Stroll stops on the pit straight. Hulkenberg, Ocon and Sainz manage to stop - will Antonelli get the chance too? #F1 #ItalianGP
      reporting:bsky:3muu6tnyfds2c     14:20 Chris Medland: Still under VSC so Antonelli and Verstappen pit to swap mediums. Antonelli on new mediums, Verstappen has hards, they come out behind Gasly in P6 and P7 respectively #F1 #ItalianGP
      reporting:bsky:3muu6xf2tw22c     14:22 Chris Medland: Antonelli clears Gasly into the second chicane and is P5 already. 13.6s off the lead, and 24 laps to go #F1 #ItalianGP
      reporting:bsky:3muu726pay22c     14:23 Chris Medland: Verstappen clears Gasly, then Antonelli repeats his move but this time on Norris for P4 This looks like Antonelli is going to stroll through to win this, unless Verstappen can keep him in range #F1 #ItalianGP
      reporting:bsky:3muu75mbfbc2c     14:25 Chris Medland: Russell noted for a yellow flag infringement #F1 #ItalianGP
      reporting:bsky:3muu7a5bx6k2c     14:27 Chris Medland: Verstappen has overtaken Norris now too, and is 2.2s behind Antonelli. Antonelli now 11.4s behind Russell #F1 #ItalianGP
      reporting:bsky:3muu7dmil5s2c     14:29 Chris Medland: Hamilton skips the first chicane, goes through the run-off area as required and that allows Antonelli a free pass for P3 #F1 #ItalianGP
      reporting:bsky:3muu7iukzj22c     14:32 Chris Medland: Antonelli with no trouble clearing traffic, and he's through on Piastri for P2. He's within nine seconds of Russell and reeling him in Verstappen passes Hamilton for P4, and needs to get Piastri quickly to stay somewhere
      reporting:bsky:3muu7jxlrrc2c     14:32 Chris Medland: This is now under investigation. That's usually suggesting a penalty... #F1 #ItalianGP
      reporting:bsky:3muu7oqvcdc2c     14:35 Chris Medland: Verstappen clinical on the brakes and dispatches Piastri into the second chicane. He's 2.3s behind Antonelli and within 10 of Russell now #F1 #ItalianGP
      reporting:bsky:3muu7rbqwzc2c     14:36 Chris Medland: No further action. Race on! #F1 #ItalianGP
      reporting:bsky:3muu7uesevc2c     14:38 Chris Medland: Piastri retakes P3 from Verstappen. There seems to be some sort of issue for the Red Bull as his pace has dropped off compared to the top two #F1 #ItalianGP
      reporting:bsky:3muu7zzq2gc2c     14:41 Chris Medland: Norris gaining on Piastri now, with Hamilton behind him Antonelli within five seconds of Russell #F1 #ItalianGP
      reporting:bsky:3muua7fp3422c     14:44 Chris Medland: Russell told to bring the car home with vibrations as his tyre opens up. That felt like code for "Don't fight Antonelli" Gap now just 2.2s #F1 #ItalianGP
      reporting:bsky:3muuaccaet22c     14:46 Chris Medland: Hamilton has been dropped by Verstappen and the McLarens. Any one of those three look capable of finishing on the podium #F1 #ItalianGP
      reporting:bsky:3muuaeaz7zk2c     14:47 Chris Medland: Here it comes... Antonelli within half a second of Russell #F1 #ItalianGP
      reporting:bsky:3muuai3hqm22c     14:49 Chris Medland: Antonelli goes off at the first chicane trying to overtake! Russell did defend, but that looked like Antonelli had no grip that wide as the track is breaking up at Turn 2! #F1 #ItalianGP
      reporting:bsky:3muuajpt5v22c     14:50 Chris Medland: Lap 50 of 53, and Antonelli is back on Russell Norris and Piastri having a good fight for P4 as well, with Verstappen escaping a little #F1 #ItalianGP
      reporting:bsky:3muuald6rlk2c     14:51 Chris Medland: Antonelli takes the lead before Ascari! That will be that, from P19 to victory #F1 #ItalianGP
      reporting:bsky:3muuanyopfc2c     14:52 Chris Medland: Norris complains Piastri pushed him off out of Curva Grande. Didn't look like there was actually a big enough gap for Norris to get into #F1 #ItalianGP
      reporting:bsky:3muuarenl2k2c     14:54 Chris Medland: Norris and Piastri fighting hard on the final lap, but Verstappen is well clear for P3 #F1 #ItalianGP
      reporting:bsky:3muuathajic2c     14:55 Chris Medland: Kimi Antonelli wins the Italian Grand Prix! Remarkable result from P19 on the grid. George Russell makes it a one-two for Mercedes, with Max Verstappen third Norris gets PIastri on the final lap by 0.1s, then Hamilton, G
      reporting:bsky:3muub2lwjbc2c     14:59 Chris Medland: That's a huge step towards the championship for Antonelli, as he wins his home grand prix Maximum points on a day he took a new power unit to set him up for the rest of the season Now 66 points clear of Russell, who hims
      reporting:bsky:3muukkpcouc2q     17:49 Chris Medland: DECISION: No further action for Tsunoda, he keeps P10. The race director said it was his decision to opt for an extra formation lap as he wasn't comfortable with Tsunoda's car positioning, but the VCARB was in the grid b
      reporting:bsky:3muupq4kypk2u     19:22 Chris Medland: Audi doesn’t like this and has notified the stewards of its intention to appeal (over the fact Tsunoda didn’t enter the pit lane after the extra formation lap) Bortoleto finished 11th, so could gain a point if Tsunoda wa
      reporting:bsky:3mv3btxzers22     10:02 Chris Medland: Red Bull has announced Robin Raikkonen - son of 2007 world champion Kimi - has joined its junior team and becomes part of its driver development programme from 2027 #F1
