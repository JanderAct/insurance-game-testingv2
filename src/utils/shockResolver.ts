// SHOCK RESOLUTION — pool level, once per year, before any line is processed.
//
// WHY IT LIVES AT POOL LEVEL. Events emit into MULTIPLE LINES FROM ONE CAUSE
// (#28 pandemic hits WC and GL; #2 would hit Property and WC). Every generator
// today is line-local — processLineYear only ever sees its own line — so the
// only correct home is processYear, which has all three lines in scope and
// already draws the shared gPool there for the same reason. Shocks are resolved
// here and per-line effects are PROJECTED DOWN through LineYearContext. A
// line-local generator must never reach across lines to discover a shock.
//
// THIS FUNCTION CONSUMES NO RANDOMNESS. That is not an implementation detail,
// it is the byte-identity guarantee. The explicit trigger path is a
// deterministic filter over a configured list, so there is no stream to open
// and therefore no stream to shift. When probability-based firing is added
// later it will open its OWN purpose-keyed label — deriveSubRng hashes the
// purpose string, so a new label cannot perturb an existing one — and it will
// populate the same ScheduledShock list that this function already reads.
// Everything downstream is unchanged by that addition.
//
// IT ALSO HOLDS NO STATE. Future-horizon persistence is recomputed every year
// as "fired in year <= N" rather than mutated onto the pool, so replaying any
// year from the instance alone gives the same answer. Determinism stays
// testable.

import type { CoverageLine, GameInstance } from '../types/simulation';
import type {
  LineShockEffects,
  ShockDefinition,
  ShockEffect,
  ShockFiring,
  ShockResolution,
} from '../types/shocks';
import { IMPLEMENTED_EFFECTS } from '../types/shocks';
import { SHOCK_CATALOG } from '../data/shockCatalog';
import { WHOLE_LINE } from './shockEffects';

function describe(effect: ShockEffect): string {
  switch (effect.kind) {
    case 'forceEvent':
      return `force ${effect.peril} in ${effect.region} at intensity ${effect.intensity}${effect.span ? ' (spanning)' : ''}`;
    case 'injectClaim': {
      const when = effect.accidentYearOffset
        ? ` backdated ${Math.abs(effect.accidentYearOffset)}yr`
        : '';
      return `inject ${effect.count} ${effect.line} claim${effect.count === 1 ? '' : 's'} at $${(effect.amount / 1e6).toFixed(2)}M${when}`;
    }
    case 'freqMultiplier':
      return `${effect.line}${effect.sub ? ` ${effect.sub}` : ''} frequency x${effect.factor}`;
    case 'componentFreqMultiplier':
      return `${effect.line} '${effect.component}' arrival rate x${effect.factor}`;
    case 'sevMultiplier':
      return `${effect.line}${effect.sub ? ` ${effect.sub}` : ''} severity x${effect.factor}`;
    case 'investmentShock':
      return `${effect.assetClass} return ${effect.returnDelta >= 0 ? '+' : ''}${(effect.returnDelta * 100).toFixed(1)}pp`;
    case 'exposureChange':
      return `${effect.line} exposure x${effect.factor}`;
    case 'poolExpense':
      return `${effect.label}: $${effect.amount.toLocaleString()}`;
    case 'paramOverride':
      return `${effect.line}.${effect.path} ${effect.multiplier !== undefined ? `x${effect.multiplier}` : `= ${effect.value}`}`;
  }
}

function lineOf(effect: ShockEffect): CoverageLine | undefined {
  return 'line' in effect ? effect.line : undefined;
}

function lineBucket(
  byLine: Partial<Record<CoverageLine, LineShockEffects>>,
  line: CoverageLine,
): LineShockEffects {
  const existing = byLine[line];
  if (existing) return existing;
  const created: LineShockEffects = {};
  byLine[line] = created;
  return created;
}

function definitionFor(shockId: string): ShockDefinition {
  const def = SHOCK_CATALOG[shockId];
  if (!def) throw new Error(`scheduled shock '${shockId}' is not in SHOCK_CATALOG`);
  return def;
}

// Resolve every shock in force for `yearNumber`.
//
// Returns UNDEFINED when nothing is in force — not an empty object. The caller
// then leaves the context field absent and the no-shock code path stays
// textually identical to what it was before shocks existed. Cheap, and it makes
// the byte-identity argument something you can read rather than reason about.
export function resolveShocks(instance: GameInstance, yearNumber: number): ShockResolution | undefined {
  const scheduled = instance.scheduledShocks;
  if (!scheduled || scheduled.length === 0) return undefined;

  const byLine: Partial<Record<CoverageLine, LineShockEffects>> = {};
  const firings: ShockFiring[] = [];

  // Deterministic order: by fire year, then by catalog id. Two overrides on the
  // same path must compose the same way on every replay.
  const inForce = scheduled
    .filter(s => s.yearNumber <= yearNumber)
    .sort((a, b) => (a.yearNumber - b.yearNumber) || a.shockId.localeCompare(b.shockId));

  for (const { shockId, yearNumber: firedYear } of inForce) {
    const def = definitionFor(shockId);

    // CURRENT-horizon events apply to their own year only; FUTURE-horizon
    // events persist from their year forward. A current event scheduled for an
    // earlier year contributes nothing now, and is not recorded as firing now.
    const active = def.horizon === 'future' || firedYear === yearNumber;
    if (!active) continue;

    const linesAffected = new Set<CoverageLine>();

    for (const effect of def.effects) {
      // A DEFINED-BUT-UNIMPLEMENTED EFFECT THROWS. It must not be silently
      // skipped: a shock that half-executes changes the numbers while claiming
      // to be a different event than it is.
      if (!IMPLEMENTED_EFFECTS.has(effect.kind)) {
        throw new Error(
          `shock ${def.id} (${def.name}) uses effect '${effect.kind}', which is defined but not implemented. `
          + `See src/types/shocks.ts for why, and do not schedule this event until it is.`,
        );
      }

      const line = lineOf(effect);
      if (line) linesAffected.add(line);

      switch (effect.kind) {
        case 'freqMultiplier': {
          const bucket = lineBucket(byLine, effect.line);
          const key = effect.sub ?? WHOLE_LINE;
          bucket.freqMultipliers = bucket.freqMultipliers ?? {};
          // Two events hitting the same sub-coverage COMPOUND rather than the
          // later one winning. Two independent causes both raising frequency
          // genuinely do both.
          bucket.freqMultipliers[key] = (bucket.freqMultipliers[key] ?? 1) * effect.factor;
          break;
        }
        case 'sevMultiplier': {
          const bucket = lineBucket(byLine, effect.line);
          const key = effect.sub ?? WHOLE_LINE;
          bucket.sevMultipliers = bucket.sevMultipliers ?? {};
          // COMPOUND, like the frequency multipliers. Two independent causes
          // each raising severity genuinely do both — and for a ratchet that is
          // the right arithmetic: two episodes leave a compounded level behind.
          bucket.sevMultipliers[key] = (bucket.sevMultipliers[key] ?? 1) * effect.factor;
          break;
        }
        case 'componentFreqMultiplier': {
          const bucket = lineBucket(byLine, effect.line);
          bucket.componentFreqMultipliers = bucket.componentFreqMultipliers ?? {};
          // Two events hitting the same component COMPOUND rather than the later
          // one winning — two independent causes both raising a rate genuinely do
          // both. Same rule as freqMultiplier.
          bucket.componentFreqMultipliers[effect.component] =
            (bucket.componentFreqMultipliers[effect.component] ?? 1) * effect.factor;
          break;
        }
        case 'injectClaim': {
          // A one-off effect on a FUTURE-horizon event fires only in the year the
          // event fired. Without this, #10's backdated reach-back would be
          // re-injected every year for the rest of the game — see the
          // firstYearOnly comment in types/shocks.ts.
          if (effect.firstYearOnly && firedYear !== yearNumber) break;
          const bucket = lineBucket(byLine, effect.line);
          bucket.injections = bucket.injections ?? [];
          bucket.injections.push({
            count: effect.count,
            amount: effect.amount,
            accidentYearOffset: effect.accidentYearOffset,
            shockId: def.id,
          });
          break;
        }
      }
    }

    firings.push({
      shockId: def.id,
      name: def.name,
      band: def.band,
      horizon: def.horizon,
      description: def.description,
      yearFired: firedYear,
      linesAffected: [...linesAffected],
      effects: def.effects.map(e => ({ kind: e.kind, detail: describe(e) })),
    });
  }

  if (firings.length === 0) return undefined;
  return { byLine, firings };
}

// ONE event's own frequency multipliers for ONE line, read back from the
// catalog — deliberately NOT from the compounded LineShockEffects, which has
// already lost track of which event contributed what.
//
// This exists for COST ATTRIBUTION. Each firing is measured against the
// unshocked baseline using only its own effects, so two events compounding on
// the same sub-coverage each report what they alone would add. Those figures do
// not sum to the combined effect, and that is correct: the question is "what
// did this event add", not "how should we split the interaction".
export function ownFreqMultipliers(shockId: string, line: CoverageLine): Record<string, number> | undefined {
  const def = SHOCK_CATALOG[shockId];
  if (!def) return undefined;
  let out: Record<string, number> | undefined;
  for (const effect of def.effects) {
    if (effect.kind !== 'freqMultiplier' || effect.line !== line) continue;
    out = out ?? {};
    const key = effect.sub ?? WHOLE_LINE;
    out[key] = (out[key] ?? 1) * effect.factor;
  }
  return out;
}

// The same, for component arrival-rate multipliers — one event's own, for cost
// attribution, read back from the catalog rather than from the compounded
// bucket.
// The same, for SEVERITY multipliers — one event's own, for cost attribution.
export function ownSevMultipliers(shockId: string, line: CoverageLine): Record<string, number> | undefined {
  const def = SHOCK_CATALOG[shockId];
  if (!def) return undefined;
  let out: Record<string, number> | undefined;
  for (const effect of def.effects) {
    if (effect.kind !== 'sevMultiplier' || effect.line !== line) continue;
    out = out ?? {};
    const key = effect.sub ?? WHOLE_LINE;
    out[key] = (out[key] ?? 1) * effect.factor;
  }
  return out;
}

export function ownComponentFreqMultipliers(shockId: string, line: CoverageLine): Record<string, number> | undefined {
  const def = SHOCK_CATALOG[shockId];
  if (!def) return undefined;
  let out: Record<string, number> | undefined;
  for (const effect of def.effects) {
    if (effect.kind !== 'componentFreqMultiplier' || effect.line !== line) continue;
    out = out ?? {};
    out[effect.component] = (out[effect.component] ?? 1) * effect.factor;
  }
  return out;
}
