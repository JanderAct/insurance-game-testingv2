# Ripple — Non-Cat Property Distribution (v3 canonical)

## Attritional (All-Risk) band · Non-Cat Weather band · Per-Risk reinsurance

Companion to `property_cat_engine_design.md` and `wc_gl_distribution_design.md`. Canonical pool: **roster_canonical_v3.csv** — 200 members, $1,300M payroll, **$6,993M total TIV (5.38× blended)**, **1,866 stored locations**, three named regions (North/Central/South).

**This is the consolidated v3 spec.** It supersedes the original non-cat doc, the v2/v3 addenda, and the cat/weather resolution for the non-cat bands. Mechanisms are unchanged; figures are current against v3. TIV and locations are **stored roster columns**, not derived — the `TIV_TYPE_MULTIPLIER`/`PROPERTY_TIV_SCALE` model is deleted.

Property has three bands: attritional (independent claims), non-cat weather (event-driven, moderate), cat (event-driven, severe — companion doc). This document is bands 1 and 2 plus the per-risk reinsurance layer.

---

## NC0. Where each band's risk lives (design intent)

| Band | Generative structure | Owns the… | Reinsurance that responds |
|---|---|---|---|
| Attritional | independent claims | routine loss + occasional large single-risk loss | **per-risk XoL** |
| Non-cat weather | event -> footprint -> correlated claims | the "many storms" bad year | **aggregate** (coverage gap) |
| Cat | rare event, severe | the extreme tail | per-occurrence cat XoL + aggregate |

**Band ordering (v3, confirmed): attritional largest, weather the moderate middle, cat smallest in the mean but owning the tail.**

| Band | Expected loss | Share |
|---|---|---|
| Attritional | $16.8M | 58% |
| Cat | $7.5M | 26% |
| Weather | $4.5M | 16% |
| **Total property** | **~$28.8M** | |

---

## NC1. Attritional (All-Risk) band

Routine property losses: fires, burst pipes, theft, vandalism, equipment breakdown, non-weather water damage. High frequency, stable, highly credible.

### NC1.1 Frequency — off stored LOCATION COUNT

```
lambda_attr = Locations x base_freq x theta_freq(RQ) x eps_m,t x g_pool x trend_freq
N_attr ~ Poisson(lambda_attr)
```

- **`Locations` is a stored roster column** (integer count of insured sites), read directly — not derived from TIV. Location count is a physical fact about a member, not a function of insured value. Pool total: **1,866 locations**.
- **Poisson is correct here** (not NegBin) — correlated, lumpy variance is quarantined into weather and cat, leaving attritional close to independent.
- `base_freq` = **0.06 claims per location per year**.
- `trend_freq` ~ 0%. eps dispersion: **small, SD ~0.15** — genuinely stable band.

### NC1.2 Severity — damage ratio x the HIT location's TIV, chopped by Primary Asset Share

Do not draw a dollar amount directly. Emerge it from the book:

```
member_TIV    = stored TIV column
Locations     = stored column
primary_share = stored Primary Asset Share column
  -> largest location value = member_TIV x primary_share
  -> each of the other (Locations - 1) locations = member_TIV x (1 - primary_share)/(Locations - 1)

hit_location <- sample one of the member's locations (weighted by count)
damageRatio  ~ Beta(mu 0.04, nu 2)              # mean-concentration form
severity     = damageRatio x hit_location.TIV   # <= location TIV by construction
```

- **Beta mu 0.04, nu 2** -> J-shaped: median ~1%, mean 4%, thin tail toward total loss.
- **The per-risk layer survives on `Primary Asset Share`, not member-level TIV skew.** This is the corrected architecture (was: "critical dependency on the TIV schedule keeping its skew"). Under v3, member-level TIV skew is *flat* — the largest single member is only **3.4%** of book TIV (B: Eastbrook cap; F: tightened jitter). But the per-risk treaty is alive because Primary Asset Share concentrates each member's TIV into one dominant location: **largest single location $93.5M** (a county courthouse/jail, a transit depot). A courthouse genuinely is one big building — physically real, not dependent on a freak member existing.
- **Consequence:** at a flat ~$2M average location, `damageRatio x locationTIV > $2M` is essentially impossible; no damage ratio breaches a $2M retention on a $2M building. The per-risk treaty exists *only* through within-member concentration. Flatten Primary Asset Share and the treaty dies — it is the mechanism.

### NC1.3 RQ channels (attritional)

Total beta target **0.12** (-> 3.3x worst-to-best):

| Channel | Constant | Notes |
|---|---|---|
| Frequency | beta_freq = 0.08 on lambda_attr | housekeeping, electrical, inspections |
| Severity | beta_sev = 0.04, scales Beta mu (`mu' = mu x exp(-beta_sev(RQ-5))`), nu fixed | sprinklers, suppression |

Apply RQ to the **damage-ratio draw**, never the dollar amount — preserves the insured-value cap. Normalize theta **TIV-weighted**. RQ is drawn **independently of member type** in v3 (source type-RQ correlation decoupled).

### NC1.4 Development (attritional)

Short-tailed. Report lag ~ 0. Payout **70% yr1 / 25% yr2 / 5% yr3**. Severity trend **+4%/yr** (construction cost).

### NC1.5 Attritional expectation (v3)

**1,866 locations x 0.06 = ~112 claims/yr.** Expected loss = **$16.78M**.

**The attritional identity — canonical, keep it:**

```
locations = TIV / avg_loc_TIV      severity = damageRatio x avg_loc_TIV
-> avg_loc_TIV CANCELS in the mean:

expected attritional loss = Total_TIV x base_freq x E[damageRatio]
                          = $6,993M x 0.06 x 0.04
                          = Total_TIV x 0.0024
                          = $16.78M
```

Attritional expected loss is three numbers: total TIV, base_freq, E[damageRatio]. The location/asset chopping (NC1.2) affects **variance and per-risk firing only**, never the loss level.

---

## NC2. Non-Cat Weather band

Hail, wind, freeze, non-catastrophic flood. Event-driven like cat, but frequent and light.

### NC2.1 Generation — event -> zone -> footprint -> correlated claims

```
M ~ Poisson(lambda_wx_per_zone) per zone   # 2.5/zone -> 3 zones x 2.5 = 7.5 events/yr pool-wide
for each event:
    zone       <- one of {North, Central, South} by weather hazard weight
    intensity  ~ LogNormal(mean 1.0, CV 0.6)
    hit_rate   = min(0.10 x intensity, 0.50)
    affected   ~ Binomial(locations_in_zone, hit_rate)
    event_mean_dr = mu_wx x intensity          # mu_wx = 0.189% (solved — see NC2.4)
    for each affected location:
        damageRatio ~ Beta(event_mean_dr, nu 4.0)   # shared mean = within-event correlation
        severity    = damageRatio x location.TIV
    occ_id <- unique per event
```

- **Three named regions**, not an unspecified zone set. lambda_wx scales with geographic spread -> 2.5/zone.
- **Shared event mean** is the mechanic: a severe storm makes all its claims worse together.
- **Signature: many simultaneous mid-sized claims, no single large one.** ~40-50 affected locations, occurrence total ~$0.6-0.9M, largest single claim well under the $5M cat attachment.

### NC2.2 The coverage gap (why weather -> aggregate)

| Treaty | Response to a weather event |
|---|---|
| Per-risk XoL | **silent** — every claim too small |
| Per-occurrence cat XoL | **silent** — occurrence total below $5M cat attachment |
| **Aggregate stop** | **responds** — a year of stacked weather events erodes into it |

Weather lives in the gap between the two occurrence treaties -> the aggregate catches it. This is why an aggregate treaty exists at all.

### NC2.3 RQ, development, boundary

- **RQ: frequency LOCKED (beta_freq = 0)** — hazard, not vulnerability. RQ affects damage ratio only (beta_sev = 0.04).
- Development: **80% yr1 / 20% yr2**. Severity trend +4%/yr; frequency flat (climate drift -> shock layer).
- **Weather/cat boundary deliberately fuzzy** — same process, overlapping ranges; a severe weather event occasionally punches into the cat retention. No hard wall.

### NC2.4 Weather expectation (v3, restated)

Old ~$5M placeholder assumed a $3.3B book; the "60 claims of $10-25K" signature back-solved to mu ~ 0.5%, which at $6.99B gives ~$13M — nearly attritional-sized, inverting NC0. **Corrected:**

| Parameter | Value |
|---|---|
| lambda_wx | 2.5/zone x 3 = 7.5 events/yr |
| Intensity | LogNormal(mean 1.0, CV 0.6) |
| hit_rate | `min(0.10 x intensity, 0.50)` |
| Beta mu_wx (event_mean_dr at intensity 1) | **0.189%** (solved numerically) |
| Beta nu | 4.0 (lighter tail than cat) |
| **Weather AAL** | **~$4.5M** |

Below cat ($7.5M) and well below attritional ($16.8M) — weather is the moderate middle, NC0 ordering restored.

> **mu_wx solved numerically, not closed-form.** Intensity enters twice (hit_rate AND event_mean_dr), so expected loss per event scales with E[I^2] = 1 + CV^2, and the footprint cap interacts with the intensity draw — no closed form lands. mu_wx = 0.189% is the numeric solution against the $4.5M target holding lambda, footprint, cap, and CV fixed. Re-solve if any move.

> **REFINEMENT (weather build, roster v4).** "No closed form lands" holds for the naive `mu/(1+CV^2)` correction only. Splitting the expectation AT the cap with exact lognormal PARTIAL moments is exact — see the same refinement note in `PROPERTY_CAT_ENGINE_DESIGN.md` P4 for the formulae, and `lognormalPartialMoment` in `src/utils/claimMath.ts`. `expectedWeatherGrossLoss` is built on it, so this band now has a genuine analytic partner to its draw (invariant 1) rather than a simulated one. Verified: `E[I x min(I, 5)] = 1.355546` vs the naive `1.360000`.
>
> Two consequences for this section's numbers. **(1) The AAL identity has no zone structure in it.** Because locations are hit by independent per-location Bernoulli draws, expected loss per event is `hit_rate(I) x mu x I x zoneTIV` whatever the size mix, and summing over zones at a COMMON lambda collapses to `lambdaPerZone x mu x E[min(bI,c)I] x totalTIV x trend`. Note `lambdaPerZone`, NOT `3 x lambdaPerZone`: 7.5 events a year, each exposing one zone. **(2) Weather AAL is therefore exactly linear in TIV**, which is why roster v4 rescaled the target from $4.50M to **$9.204M** (`x 14,303.6 / 6,993.3`) **without re-solving mu**. mu is unchanged and should stay that way: it verifies at +0.33% against the rescaled target, which is its own three-significant-figure rounding.
>
> The **Binomial(locations_in_zone, hit_rate)** in NC2.1 is implemented as a **per-location Bernoulli** instead. Distributionally identical for the count, but the affected set is then made of actual locations carrying their actual TIVs, so within-member concentration (Primary Asset Share) reaches event severity rather than being averaged away.

---

## NC3. Per-Risk reinsurance layer

Property needs **two** occurrence-basis treaties (plus the aggregate). The companion cat doc specifies the per-occurrence cat layer; this is the per-risk layer.

**Per-risk XoL** responds to a single large *individual* claim, reading the **claim** where the cat treaty reads the **occurrence total**.

```
per individual claim:
    retained_risk = min(claim, per_risk_retention)      # $2M
    ceded_risk    = min(claim - retained_risk, per_risk_limit)
```

- Fires on the large single-risk attritional losses from NC1.2 (high damage ratio on a high-value primary-asset location).
- **Inuring order:** per-risk runs **first**; cat attaches **net of per-risk recoveries** on the occurrence total.
- Division of labor: **per-risk for single large risks, cat for accumulations, aggregate for the many-storms year.**

**Per-risk retention $2M — confirmed at v3.** Re-simulated (3,000 years, stored locations + Primary Asset Share):

| Retention | Claims/yr piercing | % of attritional | Read |
|---|---|---|---|
| $1M | 3.83 | 3.41% | fires often — routine |
| **$2M** | **1.77-1.78** | **1.58%** | **~1-2 large single risks/yr — healthy** |
| $3M | 1.04 | 0.93% | fires less, still alive |

Confirmed by three independent simulations (1.77/1.78/yr).

### Full property waterfall (all bands + all layers)

```
per individual claim:
    -> per-risk XoL retention ($2M)                   # large attritional single risks
per cat/weather event (occurrence total, net of per-risk recoveries):
    -> per-occurrence cat XoL retention ($5M)         # cat; usually silent on weather
    -> occurrence limit $1B  (NOW A LIVE CONSTRAINT at v3 TIV — see cat doc P3)
accumulate ALL retained (attritional + weather + cat):
    -> aggregate stop (1.75x expected retained, finite default; unlimited upgrade)
    -> pool_net
```

---

## NC5. Calibration — the cat inversion is resolved

**Prior versions flagged a cat-AAL inversion** (cat at 63% of a $22M book) and recommended retargeting cat lambda down. **That inversion is dissolved and the recommendation withdrawn.** It was an artifact of two stale anchors — the ~$23M cat AAL came from a real (larger) portfolio while the $22M target came from a $3.3B illustration. The TIV reset to $6.99B plus **pinning physical Beta mu per peril** (not retargeting lambda) fixed it:

| Band | Expected loss | Share |
|---|---|---|
| Attritional | $16.8M | 58% |
| Cat | $7.5M | 26% |
| Weather | $4.5M | 16% |
| **Total** | **~$28.8M** | |

Cat at 26% — right at target, achieved by correcting mu (physical) rather than lambda (scale). See the companion cat doc for the mu/nu/footprint solve.

### Validation
1. All members RQ 5 -> each band's mean matches; **confirm ordering attritional > cat > weather in the mean**.
2. RQ sweeps -> `exp(+/-5x0.12)` for attritional; weather/cat frequency unaffected (hazard lock).
3. Confirm the **per-risk layer fires** ~1.8x/yr — if never, Primary Asset Share too flat or retention too high.
4. Confirm weather falls in the **coverage gap** — events rarely reach the $5M cat attachment.

---

## NC6. Open decisions — resolved

| # | Decision | Resolution |
|---|---|---|
| 1 | Location count source | **Stored `Locations` column** (1,866 total) — not derived |
| 2 | Cat AAL vs. property mix | Resolved at cat 26% via physical-mu pinning; no lambda retarget |
| 3 | Per-risk retention | **$2M**, confirmed ~1.78 breaches/yr by three sims |
| 4 | Attritional base_freq | **0.06/location** |
| 5 | Zone map | **Three named regions** shared across bands, per-peril hazard weights (cat doc) |

All hazard weights, footprints, and stored location/asset ranges remain judgmental priors — overwrite on real geography/TIV data.
