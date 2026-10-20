# Career Gate — Package C: staff accessibility, measured

Base: Package A head `bb24ff0` (PR #126). Same container, same 2,000-client performance seed, Chromium,
axe-core 4.13.0, rule tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Viewports 390×844, 820×1180,
1920×1080. Raw results in `package-c/`.

## Coverage

- Every staff route (19) at all three viewports: 57 scans.
- Interactive states on Client 360: each tab, each command-deck panel, and the command palette with
  results: 41 scans.

## Result (serious + critical nodes)

| Scope | Base `bb24ff0` | Package C |
|---|---|---|
| Staff routes, 57 scans | 3,089 | 0 |
| Interactive states (incl. `/staff`), 44 scans | 547 | 0 |
| All rules, any impact, 98 scans | — | 0 |

Base findings by rule (routes): `label` 3,000 (row checkboxes on Assignments, one per client),
`color-contrast` 38, `select-name` 33, `scrollable-region-focusable` 9, `aria-required-children` 6,
`aria-prohibited-attr` 3. States added `color-contrast` 502, `aria-prohibited-attr` 41,
`aria-required-children` 2, `listitem` 2.

## Root causes and fixes

| Finding | Cause | Fix |
|---|---|---|
| Light-on-light contrast (shortcut hint, document thumbnail, pending badge, ghost-button hover) | The staff dark-shell remap in `app/globals.css` turns `text-slate-*` light and `bg-white` / `bg-slate-50` dark, but left `bg-slate-100` light | `bg-slate-100` and `hover:bg-slate-100` join the remap |
| Unnamed form controls | Selects, inputs and row checkboxes without labels | `aria-label` naming the field or the row's client |
| `tablist` with link or button children | Link groups and a view toggle marked as tabs | Links are `nav` with `aria-current="page"`; the pipeline toggle is a group of `aria-pressed` buttons |
| `aria-label` on a plain `div` | Post-hire progress bar | `role="progressbar"` with min, max, now and text |
| Scroll region not reachable by keyboard | Horizontally scrolling tables and the kanban, notably when empty | `tabIndex={0}`, `role="region"`, a name |
| `listbox` containing a non-option | Command palette "No matches" | Status message outside the list |
| Palette result hint 1.9:1 | Remapped hint on the highlighted row | Hint takes the row's text color when highlighted |
| Error page reference 3.9:1 | `text-slate-500` on the dark error surface | `text-slate-400` |

## Visual change

Screenshots of `/staff`, `/staff/clients`, Client 360 and its Documents tab at 390, 820 and 1920 px,
base against Package C, pixel difference above a small threshold:

| | 390 | 820 | 1920 |
|---|---|---|---|
| Base vs base (noise) | 0.03–0.07% | 0–1.43% | 0–0.01% |
| Base vs Package C | 0.02–0.07% | 0.05–1.39% | 0.02–0.10% |

The change is within the noise of two captures of the same build on these views. Elements whose
appearance does change (a pending document badge, a thumbnail placeholder, the ghost-button hover) now
match the dark glass surface instead of showing a light grey box.

## CSS shipped to staff routes

40,542 → 40,559 bytes encoded (+17), 213,576 → 213,717 decoded.

## Gate

`e2e/accessibility.spec.ts` scans every staff route and the Client 360 tabs and palette at 390 and
1920 px and fails on any serious or critical finding. Control: the same spec run against the base
fails all 4 of its tests with the findings above.

## Not in this package

`EXECUTION_ORDER.md` P5 also lists one token file, dashboard PODs with their own loading states, a
command sheet led by the next action and an SVG progress path. Those change how the staff UI looks
and need a design review with screenshots; they are not done here.
