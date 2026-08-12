# Ripple — Property Catastrophe Engine (v3 canonical)

## Flood · Wildfire · Earthquake — three engines, two-layer reinsurance

Companion to `property_noncat_design.md`. Canonical pool: **roster_canonical_v3.csv** — 200 members, $1,300M payroll, **$6,993M total TIV**, **1,866 stored locations**, three named regions (North/Central/South) with per-peril hazard weights.

**This is the consolidated v3 spec.** Supersedes the original cat doc and the cat/weather resolution. Mechanisms unchanged; all figures current against v3. TIV/locations are stored roster columns (the `TIV_TYPE_MULTIPLIER`/`PROPERTY_TIV_SCALE` model is deleted).

Calibrated in **shape** to three vendor EP tables (Flood/Wildfire/Earthquake); **scale is carried by lambda alone** (see P5). Cat AAL resolved at **$7.5M total** (26% of property expected loss).

---

## P0. Design principles

1. **Three independent engines**, not one blended curve. Distinct signatures (P1); independently shockable and independently reinsurable.
2. **lambda is the SOLE scale dial.** Footprint, damage-ratio mu, and intensity CV are **physical characteristics**, not budget knobs. This is a correction from earlier drafts that treated footprint as a second dial — three free parameters against one AAL target is underdetermined.
3. **Severity = damage ratio x exposed TIV in the affected zone**, via a within-zone Binomial footprint. Bounds loss at insured value, ties event size to the live book, makes concentration bite, lets dollar AAL flex with TIV.

---

## P1. Peril signatures (from the EP tables)

| Peril | SD/AAL (source) | 1-in-100 -> 1-in-1000 slope | Tail | Engine implication |
|---|---|---|---|---|
| Flood | 1.38 | 1.58x | heaviest | high lambda, fat per-event tail |
| Wildfire | 1.04 | 1.42x | lightest | highest lambda, light tail — smoothness from frequency |
| Earthquake | 1.54 | 1.47x | heavy, wide footprint | lowest lambda, fat tail, can span two regions |

**The EP tables validate MIX and RETURN-PERIOD SLOPE — not SD/AAL. See P6 for why (SD/AAL is a pool-scale artifact and quake structurally cannot match it).**

---

## P2. Per-peril generation — within-zone Binomial footprint

Per peril, per year:

```
N ~ Poisson(lambda_peril)                   # lambda = the scale dial (P4)
for each event:
    zone       <- draw region by per-peril hazard weight (P2.1)
    intensity  ~ LogNormal(mean 1.0, CV_peril)
    hit_rate   = min(base_footprint_peril x intensity, cap_peril)
    affected   ~ Binomial(locations_in_zone, hit_rate)
    event_mean_dr = mu_peril x intensity
    for each affected location:
        damageRatio ~ Beta(event_mean_dr, nu_peril)   # shared mean = within-event correlation
        severity    = damageRatio x location.TIV
    occ_id <- unique per event
```

Full-zone exposure (no footprint) would put ~$2,331M avg per zone in every event — flood alone would run ~$49M AAL, ~13x budget. The Binomial footprint is mandatory and makes **weather and cat structurally identical** (event -> zone -> footprint -> correlated claims), the P0 intent.

Both footprint and damage scale with intensity, so a high-intensity draw makes an event severe — the mechanism that produces tail events.

### P2.1 Regions and per-peril hazard weights

Members carry a stored **Region** (North/Central/South). Events draw a region by hazard weight — the ONLY thing differentiating the three regions (assignment is random, TIV near-even N 35.9 / C 34.3 / S 29.7). Uniform weights would make geography decorative.

| Peril | North | Central | South | Rationale |
|---|---|---|---|---|
| Flood | 0.30 | 0.25 | 0.45 | South = coastal/riverine |
| Wildfire | 0.45 | 0.35 | 0.20 | North = WUI / dry interface |
| Earthquake | 0.25 | 0.45 | 0.30 | Central = fault proximity |

### P2.2 Earthquake adjacency — the two-region span

**Earthquake alone can span two ADJACENT regions in one occurrence; flood and wildfire are always single-region.**

- Adjacency: North<->Central adjacent, Central<->South adjacent, **North<->South NOT adjacent**.
- Earthquake drawing Central: with `P_span = 0.35` also engages one adjacent region (North or South, 50/50), exposing both under **one occurrence ID**. Effective extra-zone exposure = P(Central) x P_span = 0.45 x 0.35 = **0.1575 zone-equivalents**.
- Max footprint: **two of three regions** — North+South never co-occur.

This is the only mechanism that manufactures a two-region correlated accumulation — earthquake's "widest footprint" character and what makes the occurrence limit a live constraint (P3).

### P2.3 RQ and the hazard/vulnerability lock

**Event frequency (lambda), zone draw, and footprint are NEVER modified by RQ** — hazard is nature's, not the member's. RQ affects **damage ratio only** (vulnerability: retrofit, defensible space, flood-proofing): `mu' = mu x exp(-beta_sev x (RQ-5))`, beta_sev ~0.04 flood/wildfire, ~0.015 quake. Applied per member within the event.

---

## P3. Reinsurance — two layers

### Layer 1 — Per-occurrence (each cat event + large single-risk property)

```
retained_occ = min(grossLoss, occ_attachment)     # $5M
ceded_occ    = min(grossLoss - retained_occ, occ_limit)   # occ_limit = $1B
```

**The $1B occurrence limit is a LIVE CONSTRAINT at v3 TIV — do NOT assert it never binds.** This is corrected from earlier drafts (which assumed pool TIV ~$1-1.5B and asserted non-binding). At $6.99B:

- A two-region earthquake (P2.2) exposes up to **~$4,662M** of TIV (two zones).
- Simulated span-quake occurrences: **max ~$2,224M, and ~0.175% exceed $1B.** The limit binds. Above $1B the pool **re-retains the excess**.
- So: model the $1B limit as active. It rarely fires, but when a high-intensity two-region quake lands, the pool takes back everything above $1B — a genuine tail exposure and a real reason the aggregate matters.

### Layer 2 — Aggregate stop (on the year's accumulated RETAINED losses)

```
annual_retained = sum retained_occ (all cat events) + retained weather + retained attritional
agg_attachment  = 1.75 x expected_annual_retained     # default finite
pool_net        = min(annual_retained, agg_attachment) # finite (default)
                = annual_retained                       # if unlimited upgrade bought
```

- Default finite at 175% of expected retained; **unlimited is a purchasable upgrade**.
- The only thing capping a bad-*accumulation* year (several perils each piercing the occurrence attachment, or an over-$1B quake the pool re-retained). Same coverage-gap logic as weather.
- Key game lever: finite-cheap vs unlimited-expensive — the disciplined-vs-aggressive tradeoff.

### Waterfall order

```
per cat/large-risk occurrence:
    grossLoss -> $5M occ retention -> occ ceded up to $1B -> pool re-retains any excess over $1B
accumulate all retained (cat + weather + attritional)
    -> aggregate stop (1.75x, finite default / unlimited upgrade) -> pool_net
```

---

## P4. The pinned parameter set (v3)

**lambda in its physical range, footprints physical, mu solved numerically to hit the EP-table mix at $7.5M total:**

| Peril | lambda | base_footprint | cap | intensity CV | Beta mu | Beta nu | Mean AAL | Share |
|---|---|---|---|---|---|---|---|---|
| Flood | 0.70 | 0.15 | 0.60 | 0.7 | **0.818%** | 1.5 | $2.90M | 38.8% |
| Wildfire | 0.80 | 0.20 | 0.70 | 0.5 | **0.582%** | 2.5 | $2.71M | 36.3% |
| Earthquake | 0.045 | 0.40 | 0.95 | 1.1 | **2.532%** | 1.5 | $1.87M | 25.0% |
| **Total** | | | | | | | **$7.47M** | |

Mix matches the EP tables (38.5 / 36.3 / 25.2) with **lambda inside P4 ranges and footprints physical**. No parameter had to leave its stated range — the earlier overshoot was an illustrative 3% mu used everywhere, not a structural problem.

> **mu is solved NUMERICALLY, not from a closed form.** Intensity enters twice — `hit_rate = min(base x intensity, cap)` AND `event_mean_dr = mu x intensity` — so expected loss per event scales with E[I^2] = 1 + CV^2, not E[I]^2 = 1. A closed-form mu/(1+CV^2) correction does NOT land, because the footprint cap interacts with the intensity draw (quake especially — cap 0.95 binds often at CV 1.1). mu is solved by simulation against each peril's target AAL, holding lambda, base_footprint, cap, and CV fixed. The mu values above are the numeric solutions (earlier draft values 1.18/0.73/3.83% were pre-correction and are superseded).

> **REFINEMENT (weather build, roster v4).** The paragraph above is right that the naive `mu/(1+CV^2)` correction fails and right about why. It is wrong only in the stronger conclusion that *no* closed form lands. **Splitting the expectation AT the cap is exact**, with no quadrature:
>
> ```
> E[min(b x I, c) x I] = b x E[I^2 1{I <= c/b}] + c x (E[I] - E[I 1{I <= c/b}])
> E[I^k 1{I <= t}]     = exp(k mu_ln + k^2 sigma^2 / 2) x Phi((ln t - mu_ln - k sigma^2) / sigma)
> ```
>
> valid because intensity is LogNormal here (P2.1) and E[I] = 1 exactly. Implemented as `lognormalPartialMoment` in `src/utils/claimMath.ts`; the weather band's AAL identity is built on it and verified to five decimals — `E[I x min(I, 5)] = 1.355546` against the naive `1 + CV^2 = 1.360000`, the cap accounting for the 0.328% gap. The same form applies to each cat peril, since all three share the `min(base x I, cap) x mu x I` structure.
>
> Two caveats before relying on it for cat. **(1)** It is exact for a cap on the FOOTPRINT only. If the eventual generator also clamps the damage-ratio mean (quake's `mu x I` reaches 1 near I = 39, probability ~3e-6 at CV 1.1), that clamp needs its own split. **(2)** It gives the per-event expectation; the zone hazard weights and the quake adjacency span still multiply in separately, and the span is load-bearing (see the note below).
>
> **This does NOT license re-solving the mu values.** They verify well inside tolerance as they stand — weather sits +0.33% from its target, which is mu's rounding to three significant figures — and moving a pinned constant for no behavioural gain is a worse trade than leaving a 0.33% residual documented. The closed form is recorded so an exact solve is *available* if some future change makes it worth doing.

> **Quake AAL only reconciles WITH adjacency.** 0.045 x 0.40 x $2,331M x 2.532% = ~$1.05M single-zone; reaching $1.87M requires the two-region span contributing the 0.1575 extra zone-equivalents (P2.2). Non-obvious enough that a naive re-derivation will look wrong — the span is load-bearing for the quake number.

---

## P5. Scale — lambda is the only dial

Governing identity (in expectation, before the intensity-squaring and cap effects that force the numeric solve):

```
AAL ~ lambda x footprint x zone_TIV x mu x (1 + CV^2)   # squared term from double intensity entry
```

- **lambda carries scale.** Footprint, mu, CV are physical. If total property loss needs adjusting, move lambda, not footprint or mu.
- Preserves P6 (EP tables validate shape; lambda carries scale) and keeps events physical (tuning footprint to a budget produces unphysical events — e.g. a very localized flood arriving 0.7x/yr).
- Cat resolved at **$7.5M = 26% of property expected loss**, achieved by pinning physical mu, NOT by retargeting lambda. The earlier "~$23M implied cat AAL" was a stale-portfolio artifact.

---

## P6. Validation — MIX and SLOPE, not SD/AAL

The EP tables validate two scale-free quantities:

**1. AAL mix** — flood 38.5 / wildfire 36.3 / quake 25.2. Reproduced: 38.8 / 36.3 / 25.0.

**2. Return-period slope** (1-in-100 -> 1-in-1000), scale-free:

| Peril | nu | Simulated slope | Table slope | Read |
|---|---|---|---|---|
| Flood | 1.5 | 1.43 | 1.58 | **known deviation — still light at nu's low end; do not overstate as matched** |
| Wildfire | 2.5 | 1.41 | 1.42 | matched |
| Earthquake | 1.5 | 1.37 | 1.47 | light; low nu + span help |

Flood's tail is recorded as a **known deviation**, not a match — at nu 1.5 (already the low end) the slope is 1.43 vs 1.58, and "low nu closes most of the gap" would overstate it. Acceptable; flagged.

**Do NOT gate on SD/AAL — proof it's structurally unmatchable at this scale:**

- The tables' SD/AAL (flood 1.38 / wildfire 1.04 / quake 1.54) are on **retained** loss (the $5M-attachment column), not gross. Retention compresses volatility; validating gross output against a retained ratio is a category error.
- **Quake cannot match, and it's exactly derivable.** At lambda 0.045 with a $5M attachment on this book, **every quake event pierces the attachment**, so retained loss per event = the attachment and:
  - retained AAL = lambda x attachment = 0.045 x $5M = **$0.225M** (exact)
  - annual retained loss is Poisson-count x constant, so retained SD/AAL = **1/sqrt(lambda) = 1/sqrt(0.045) = 4.71**
  - **No severity parameter (mu, nu) can move this** — it's pure frequency. Matching the table's 1.54 would need lambda ~= 0.42, ~10x P4's range and physically wrong for earthquake.
- Flood/wildfire retained SD/AAL come nearer (flood measured 1.28 vs 1.38) but are still portfolio-specific.

**Conclusion:** keep SD/AAL as an informational check on **retained** loss for flood/wildfire; document quake as structurally unable to match; never use SD/AAL as a pass/fail gate. Consistent with the WC/GL standing policy — assert scale-free structural ratios, treat source absolutes as reference.

---

## P7. Open decisions — resolved

| # | Decision | Resolution |
|---|---|---|
| 1 | Per-peril AAL scale | **$7.5M total** (flood 38.8 / wild 36.3 / quake 25.0), lambda-carried |
| 2 | Aggregate stop multiple | 1.75x expected retained, finite default |
| 3 | Unlimited aggregate | purchasable upgrade, off by default |
| 4 | Occurrence attachment | $5M |
| 5 | Zone map granularity | **three named regions**, per-peril hazard weights (P2.1) |
| 6 | Weather vs cat boundary | separate engines, overlapping tails, no hard wall |
| 7 | **Occurrence $1B limit** | **LIVE CONSTRAINT — binds ~0.175% of span-quakes; pool re-retains excess. Do not assert non-binding.** |

## P8. Integration notes

- **Occurrence $1B limit is active** — do NOT assert it never binds. Model the pool re-retaining excess above $1B on the rare over-limit two-region quake.
- Aggregate operates on **retained** losses across **all property bands** (cat + weather + attritional).
- `expected_annual_retained` (agg attachment) and all mu solves must be **recomputed when TIV/roster changes** — same discipline as RQ theta normalization.
- mu values are numeric solves against target AAL — re-solve if lambda, footprint, cap, or CV change.
- Three independent Poisson draws/year, summed; correlate only through shared geography, never a shared severity draw.
- All hazard weights, footprints, CVs, and mu/nu are judgmental priors pending real geography/hazard data — but internally consistent and physically defensible.
