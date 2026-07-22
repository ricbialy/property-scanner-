# Field-validation worksheet (spec §15.2)

Purpose: measure real accuracy before any tolerance is marketed. Repeat on at
least **five materially different properties** (sizes, wall materials, lighting,
window styles). No accuracy claims may be made until this data exists.

## Protocol per property

1. Scan the floor with the app (note device, conditions, scan duration).
2. In the browser, record RoomPlan's values **before** correcting anything.
3. Measure every opening with a calibrated laser or tape.
4. Correct + verify in the browser; note correction time per opening.
5. Append one row per opening to `field-validation.csv`.

## Columns (`field-validation.csv`)

| Column                   | Meaning                                                    |
| ------------------------ | ---------------------------------------------------------- |
| property                 | Short property label                                       |
| room                     | Room name                                                  |
| opening_key              | Schedule key (W01, D02…)                                   |
| opening_type             | window / door / open_passage                               |
| dimension                | width / height / sill_height                               |
| roomplan_in              | Raw RoomPlan value, inches                                 |
| corrected_in             | Value after browser correction, inches                     |
| reference_in             | Laser/tape value, inches                                   |
| device                   | e.g. iPhone 15 Pro                                         |
| conditions               | lighting/occlusion notes                                   |
| detected                 | yes / no (did RoomPlan find this opening at all)           |
| correct_wall             | yes / no (attached to the right wall)                      |
| false_opening            | yes when RoomPlan invented an opening (reference_in empty) |
| correction_seconds       | Time spent correcting this opening                         |
| scan_to_schedule_minutes | Once per property: scan start → usable schedule            |

## Computing the statistics

```bash
node scripts/field-stats.mjs docs/testing/field-validation.csv
```

Reports: median / 90th-percentile / maximum absolute error (RoomPlan vs
reference, and corrected vs reference), detection rate, false-opening rate,
average correction time, and average scan-to-schedule time.
