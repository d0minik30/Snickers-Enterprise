# Mission screen (Watch) declutter — short design

**Why:** the Mission screen is shown to a jury. Too much repeated information means they don't know where to look.
It should be clear at a glance what is what.

**Rule:** each fact has one home. Changes apply only when Control/Field are embedded in `/mission/`
(`useEmbedded()`); standalone `/control/` and `/field/` stay as they are.

| Fact | One home | Removed (embedded only) |
|---|---|---|
| What to do now | top step line | Earth status chip + traveller name row; Mars "route has arrived" title and stats (START button stays) |
| 11:20 delay | yellow "11:20 OLD" bar, comms log, LAST RECEIVED map tag | signal timeline, "new routes reach Mars in…", "will arrive at … UTC", "probably X further along" |
| Trip numbers | Mars: distance left, time left, accuracy | Earth's 4 cells (progress bar stays), Mars speed |
| Who / where | pane labels EARTH / MARS | "LANDING SITE → …" row, pane subtitles |
| Navigation | Mars turn cue | HDG and WAYPOINT boxes |

Also: Mars LOG button and photo-fix small print/real-fix link; Watch map hazard + sand text tags and EARLIEST REROUTE
(hatched areas stay; "MARKED · CREW NOT TOLD YET" stays because it is the feedback for an Earth action).

**Approaches:** (a) hide behind `useEmbedded()` — chosen, keeps standalone pages and their tests intact;
(b) remove everywhere — rejected, standalone Control needs its own numbers.

**Not in scope:** Plan tab, speed buttons.
