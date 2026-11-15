# UX clean-up notes

Running log of the "make it easy to understand" pass. Newest at the bottom.

## Goals (from the team)

1. Landing page: easy to understand, two big choices: **Explore the map** and **Run a mission**.
2. Mission planner (Control) and mission viewer (Field) on **one screen**, both live.
3. Time runs too slow: add speed-ups up to **1000×**.
4. Show a clear message when a mission is finished.
5. Remove information that doesn't help; plain words everywhere.

## Log

- **Speed-ups.** Speeds are now 1×, 10×, 30×, 100×, 300×, 1000× (was up to 60×). Default is 100×, so the
  11:20 signal delay takes about 7 s and a 6 km walk about 1 min. File: `lib/mission/types.ts`.
