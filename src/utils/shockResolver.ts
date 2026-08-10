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
import { SHOCK_CATALOG, readModelPath } from '../data/shockCatalog';
import { WHOLE_LINE } from './shockEffects';

function describe(effect: ShockEffect): string {
  switch (effect.kind) {
    case 'forceEvent':
      return `force ${effect.peril} in ${effect.region} at intensity ${effect.intensity}${effect.span ? ' (spanning)' : ''}`;
    case 'injectClaim':
      return `inject ${effect.count} ${effect.line} ${effect.tier} claim${effect.count === 1 ? '' : 's'}`;
    case 'freqMultiplier':
      return `${effect.line}${effect.sub ? ` ${effect.sub}` : ''} frequency x${effect.factor}`;
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
  const paramOverrides: Partial<Record<CoverageLine, Record<string, number>>> = {};
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
        case 'injectClaim': {
          const bucket = lineBucket(byLine, effect.line);
          bucket.injections = bucket.injections ?? [];
          bucket.injections.push({ tier: effect.tier, count: effect.count, ratingClass: effect.ratingClass, shockId: def.id });
          break;
        }
        case 'paramOverride': {
          const perLine = paramOverrides[effect.line] ?? {};
          // Resolve against any EARLIER override of the same path, falling back
          // to the model's own value — so two successive expansions of the same
          // parameter compound, which is what successive legislation does.
          const base = perLine[effect.path] ?? readModelPath(effect.line, effect.path);
          if (base === undefined) {
            throw new Error(`shock ${def.id}: paramOverride path '${effect.path}' does not resolve on ${effect.line}`);
          }
          perLine[effect.path] = effect.multiplier !== undefined ? base * effect.multiplier : effect.value!;
          paramOverrides[effect.line] = perLine;
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
  return { byLine, paramOverrides, firings };
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
// The same, for parameter overrides. Resolved against the MODEL's own value
// rather than against any earlier override, so the figure answers "what would
// this event alone have added" — which is what per-event attribution means.
export function ownParamOverrides(shockId: string, line: CoverageLine): Record<string, number> | undefined {
  const def = SHOCK_CATALOG[shockId];
  if (!def) return undefined;
  let out: Record<string, number> | undefined;
  for (const effect of def.effects) {
    if (effect.kind !== 'paramOverride' || effect.line !== line) continue;
    const base = readModelPath(line, effect.path);
    if (base === undefined) continue;
    out = out ?? {};
    out[effect.path] = effect.multiplier !== undefined ? base * effect.multiplier : effect.value!;
  }
  return out;
}

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
