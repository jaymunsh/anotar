# Period diaries

Scope: src/journal/PeriodDiary.tsx, period-diary.css, PeriodOverview.tsx. Mode: Operate. Code-led functional redesign of the rejected list-only period view.

THESIS: Calendar-shaped diaries reveal when activity happened and connect broad periods to daily records.
OWN-WORLD: Preserve Anotar ivory, forest green, self-hosted type and compact journal controls. Native calendar/time geometry carries the data; no raster interface or unpersisted goal fields.
STORY: Week shows seven single-column days with scheduled plans and explicit unfinished/deferred states; separate actual entries are excluded from presentation; month shows daily activities; quarter presents three month calendars; year shows twelve record maps. Open a month, then a date; status lists remain a secondary disclosure.
FIRST VIEWPORT: Period heading and concise real totals, immediately followed by the diary. Explanation and status lists are collapsed below it. Mobile weekly time grid scrolls within its labeled region; quarter stacks months and year uses two columns.
FORM: User requested diary/tracker-like visual periods and explicitly rejected simple lists. Generic calendar conventions and the established Anotar journal supply form. The merchant reference supplies goal/reflection concepts, not a copied layout or assets.
FINISH: Verify saved records, notes, drill-down, explicit status filtering and calendar boundaries. Local only; fresh finish review and updated DESIGN/JSON accompany the completed build.

Required captures: .impeccable/review/period-diary/{week,month,quarter,year}-{1440,320}.png. QA also checks 390px Korean. No approved comp or new bitmap assets. User's original daily journal remains the daily-view authority.

2026-10-12 user correction: remove Past journals navigation; the former /app/history route redirects to monthly diary. Screenshot /var/folders/5y/nx4gbxnj3tx8ggmtgldzbwg80000gn/T/orca-paste-1791814202870-4908f875-08ea-42c9-b6f1-38a0bf47cb50.png shows duplicated side-by-side weekly blocks. New weekly diary does not reserve actual lanes or duplicate linked entries. Only genuine concurrent activities share width; stored plan/actual data remains unchanged.

2026-10-13 correction: user does not maintain a separate actual-time workflow. Remove actual totals, legends, colors, tooltips, standalone entry blocks and entry actions from all journal views. Keep legacy data stored/exportable. Weekly headers are 64px. Headline totals are planned time and checked priorities.
