# Recurring Activity Ready Reckoner

A rotation tracker for recurring monthly and weekly team activities, shared by **Ashok**, **Haran**, and **Sharan**. Snapshot as of **03-Aug-2026**.

---

## Dashboard (at a glance)

### Monthly Activities — Last / Current / Next / Month After

| Activity | Last Month | Current Month | Next Month | Month After Next |
|---|---|---|---|---|
| Huan' VMs Patching | – | Ashok | Haran | Sharan |
| ME VMs Patching | – | Sharan | Ashok | Haran |
| BJ Inventory Followup | – | Ashok | Haran | Sharan |
| ME Hotfix | – | Sharan | Ashok | Haran |
| DC Patching | – | All 3 | All 3 | All 3 |
| Ext. Inventory follow up | – | All 3 | All 3 | All 3 |
| Proxmox Migration | – | All 3 | All 3 | All 3 |

*"Last Month" shows "–" until a full month has passed since the tracker started. The rotation officially advances on the 5th of each month, not the 1st.*

**Workload Balance (rotating activities, full 3-year schedule):** Ashok, Haran, and Sharan each carry **48** total assignments — perfectly even.

### Weekly Activities — Last / Current / Next / Week After

| Activity | Last Week | Current Week | Next Week | Week After Next |
|---|---|---|---|---|
| Weekly Report | Ashok | Haran | Sharan | Ashok |

*"Last Week" shows "–" until a full week has passed. The dashboard's current/next week updates every Monday, even though the rotation cycle itself may start on a different weekday.*

**Weekly Workload Balance (3-year / 156-week schedule):** Ashok, Haran, and Sharan each carry **52** total assignments — perfectly even.

---

## Setup

Editable configuration sheet (yellow cells only — everything else is formula-driven).

**Team Members:** Ashok, Haran, Sharan *(3 of several available slots filled; more rows ready as the team grows)*

**Recurring Activities & Rotation Start (Monthly):**

| Activity Name | Currently Done By | Rotation Behavior |
|---|---|---|
| Huan' VMs Patching | Ashok | Rotates among the 3 |
| ME VMs Patching | Sharan | Rotates among the 3 |
| BJ Inventory Followup | Ashok | Rotates among the 3 |
| ME Hotfix | Sharan | Rotates among the 3 |
| DC Patching | All 3 | Fixed/shared — never rotates |
| Ext. Inventory follow up | All 3 | Fixed/shared — never rotates |
| Proxmox Migration | All 3 | Fixed/shared — never rotates |

**Weekly Activities & Rotation Start (same 3 team members):**

| Activity Name | Currently Done By | Rotation Behavior |
|---|---|---|
| Weekly Report | Ashok | Rotates among the 3 |

*Rule: typing a custom label (e.g. "All 3") instead of a person's name makes an activity shared/fixed — it shows every period unchanged and is excluded from round-robin math. 9 more blank weekly rows are ready, scaling up to 10 weekly activities.*

---

## Monthly Assignments & History

Full rotation schedule, **Jul-2026 through Jun-2029** (36 months / 3 years), auto-generated from Setup. The 4 rotating activities cycle **Ashok → Haran → Sharan** every month; the 3 shared activities stay **"All 3"** throughout.

Sample (first 6 months):

| Month | Huan' VMs Patching | ME VMs Patching | BJ Inventory Followup | ME Hotfix | DC Patching | Ext. Inventory Follow Up | Proxmox Migration |
|---|---|---|---|---|---|---|---|
| Jul-2026 | Ashok | Sharan | Ashok | Sharan | All 3 | All 3 | All 3 |
| Aug-2026 | Haran | Ashok | Haran | Ashok | All 3 | All 3 | All 3 |
| Sep-2026 | Sharan | Haran | Sharan | Haran | All 3 | All 3 | All 3 |
| Oct-2026 | Ashok | Sharan | Ashok | Sharan | All 3 | All 3 | All 3 |
| Nov-2026 | Haran | Ashok | Haran | Ashok | All 3 | All 3 | All 3 |
| Dec-2026 | Sharan | Haran | Sharan | Haran | All 3 | All 3 | All 3 |

*Pattern repeats identically every 3 months for all 36 months in the sheet (through Jun-2029). Any manual reassignment (leave, handover) should be logged in "Monthly Overrides," which automatically overrides the auto-pick shown here.*

---

## Monthly Overrides

An empty audit-trail log for one-off reassignments to rotating monthly activities (e.g. due to leave). Columns: **Month | Activity | Assigned To | Reason | Key (auto)**. No overrides logged yet. Shared activities like "All 3" never need an override since they don't rotate.

---

## Weekly Assignments & History

Full rotation schedule, **week of 29-Jul-2026 through 18-Jul-2029** (156 weeks / 3 years), auto-generated from Setup. "Weekly Report" cycles **Ashok → Haran → Sharan** every week.

Sample (first 6 weeks):

| Week Starting | Weekly Report |
|---|---|
| 29-Jul-2026 | Ashok |
| 05-Aug-2026 | Haran |
| 12-Aug-2026 | Sharan |
| 19-Aug-2026 | Ashok |
| 26-Aug-2026 | Haran |
| 02-Sep-2026 | Sharan |

*Pattern repeats every 3 weeks for all 156 weeks in the sheet.*

---

## Weekly Overrides

An empty audit-trail log for one-off reassignments to rotating weekly tasks. Columns: **Week Starting | Activity | Assigned To | Reason | Key (auto)**. No overrides logged yet.

---

## How the workbook works

1. **Setup** is the only sheet meant for manual edits (team names, activity names, who's currently doing each task).
2. **Monthly Assignments** and **Weekly Assignments** auto-calculate the full rotation via formulas, referencing Setup.
3. **Dashboard** pulls the current/adjacent periods from those two schedule sheets for a quick "who owns what right now" view, plus workload-balance totals.
4. **Monthly Overrides** / **Weekly Overrides** let you log exceptions (leave, handovers) that take priority over the automatic rotation, without disturbing the underlying formulas.
5. Rotating activities (owner = a team member) cycle evenly across Ashok, Haran, and Sharan. Shared activities (owner = a custom label like "All 3") stay fixed and are excluded from the rotation math.
