# V2 Royalty Analysis Pipeline — Spec

Complete functional spec for v2 features — statement merger, projection model, advance/IRR calculator. Derived from reference files `royalty_merger.py` + `Royalty_Summary_MASTER.xlsm` (not in repo — in user's Downloads).

## V2 Pipeline Overview

End-to-end royalty analysis and deal structuring pipeline being built into the RTHM App's new **Data Manager** page (sidebar, above Deal Manager).

```
Raw statements (CSV/XLS/XLSX per distributor per period)
    |  [Statement Merger]
merged dataset (standardized schema)
    |  [Pivot engine]
Pivot Table (Track x Date -> royalty_amount)
    |  [Projection engine]
90-period projections per track (decay model)
    |  [Advance Calculator]
Deal pricing: advance amounts, IRR, recoupment across terms
```

---

## PART 1: Statement Merger

**Purpose:** Take a folder of raw royalty statement files and merge into a single schema-standardized dataset.

**Input:** Folder of .csv, .xlsx, .xls files (skips files with "merged", "summary", "basic" in name, skips `~$` temp files).

**Workflow:**
1. Discover files in folder
2. Read & standardize column names per file
3. User selects the earnings column -> renamed to `royalty_amount`
4. Extract dates from filenames (with learning loop for ambiguous names), fallback to column-based dates
5. User includes/excludes columns
6. Merge all files into single dataset

**Output schema (stable columns):**
- `date` — First of month (YYYY-MM-01)
- `formatted_date` — Date object
- `uk_date` — DD/MM/YYYY display
- `month` — Integer 1-12
- `year` — Integer
- `quarter` — Integer 1-4
- `filename` — Source file name
- `royalty_amount` — Numeric earnings value
- Plus any other columns user chose to keep

---

## PART 2: Pivot Table

Built from merged data:
- **Rows:** Track name (single field)
- **Columns:** Date (grouped by period — Monthly/Quarterly/Half-yearly)
- **Values:** Sum of royalty_amount

---

## PART 3: Projection Model

### Track Selection
- Rank tracks by total royalty in last 3 periods
- Top 80% cumulative -> individual projection lines
- Bottom 20% -> rolled into "OTHER" bucket
- Grand Total line

### Portfolio Default Parameters
| Parameter | Default | Meaning |
|-----------|---------|---------|
| k0 | 0.06 | Initial decay rate per period |
| k_inf | 0.015 | Long-run tail decay rate |
| gamma | 0.7 | Speed of transition k0 -> k_inf |
| floor_pct | 0.5 | Floor as % of baseline |
| haircut | 0.1 | Prudence discount on baseline |
| baseline_override | (blank) | Hard override for computed baseline |

Per-track overrides: each top track + OTHER can override any parameter. Blank = use default.

### Baseline Calculation (per track)
1. shortAvg = average of last 3 periods
2. longAvg = average of last ~12 months (12/stepMonths periods)
3. w = MIN(1, monthsHistory / 12)
4. rawBaseline = w * shortAvg + (1-w) * longAvg
5. baseline = rawBaseline * (1 - haircut)
6. If baseline_override set, use that instead

### Floor Calculation
- candidateA = baseline * floor_pct
- candidateB = longAvg * floor_pct
- floor = MAX(candidateA, candidateB)

### Decay Projection (90-month horizon)
- Horizon = 90 MONTHS, not 90 periods. Period count = CEIL(90 / stepMonths) → 90 / 30 / 15 for monthly / quarterly / semi-annual cadence.
- k0, k_inf, gamma stored as per-month values; auto-scaled by stepMonths
- k(p) = k_inf + (k0 - k_inf) * e^(-gamma * stepMonths * (p - 1))   *(per-period decay rate; p starts at 1, k(1) = k0)*
- k_period = k(p) * stepMonths                                     *(monthly rate scaled to the actual step size)*
- cumulative_k accumulates k_period each period (running total)
- projected(p) = floor + (baseline - floor) * e^(-cumulative_k)
- Curve decays from baseline toward floor, never below floor

### Genre Guidance
- Evergreen/catalogue: k0 0.04-0.08, k_inf 0.01-0.02, gamma 0.08-0.15, floor_pct 0.20-0.35
- Hip-hop/rap: k0 0.12-0.25, k_inf 0.02-0.05, gamma 0.18-0.35, floor_pct 0.05-0.15

---

## PART 4: Advance/IRR Calculator

**7 side-by-side scenarios:** 18m, 24m, 36m, 48m, 60m, Bespoke, "Req months for Advance"

**Inputs per scenario:**
- Advance amount
- Referral fee % (default 1%)
- Other Fees
- RAS Cost = Advance + (Advance * Referral%) + Other Fees
- Investment Date, 1st Royalty Payment Date
- Step (months)

**Outputs per scenario:**
- Recoupment — cumulative projected royalties over term
- IRR — via XIRR (date-weighted)
- Cash flow table: Period 0 = -RAS Cost, Periods 1-N = projected payments
- Target IRR = 30%

**Last column:** Given fixed advance, solve for required months to recoup at target IRR.

---

## Architecture — Modularity Rule

**Data Manager and Deal Manager are completely separate modules** — own data, own state, own API endpoints, no cross-dependencies.

**Why:** V3 will hook the two together, but v2 must keep them decoupled so each can be built and tested independently.

**How to apply:** Never import Deal Manager state/data into Data Manager or vice versa. No shared hooks, no shared data files. Design Data Manager APIs and data storage to be self-contained. When v3 integration comes, it will be a new linking layer on top, not entanglement between the two.
