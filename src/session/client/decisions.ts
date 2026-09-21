// ============================================================================
// DECISIONS ACROSS THE WIRE.
//
// ⚠ THE SESSION LAYER NEVER INTERPRETS A DecisionSet. It is carried as an opaque
// JsonValue from submit to read and back, and this file is the ONLY place that
// knows the two are the same thing. That is deliberate: the moment the transport
// understood the engine's decision shape, every engine change would become a
// session-layer change too.
//
// ⚠ CARRY-FORWARD SOURCES FROM THE LAST SUBMITTED SET, NEVER FROM DEFAULTS. A
// team that misses a deadline has not changed its mind — it has been busy. Some
// of these fields are deliberate standing policy (Renew All, No New Business,
// funding at expected) and silently resetting them to defaults would undo a
// choice somebody made on purpose, then attribute the consequences to them.
//
// ⚠ AND "THE LAST SUBMITTED SET" IS NOW ANSWERED PER TARGET YEAR. The room holds
// a history rather than one slot, so the question is no longer "what did this
// team last choose" but "what were they playing in year N" — which for a year
// they locked is that year's own set, and for a year they missed is the most
// recent LOCK BEFORE IT. Looking forward would be the original defect with the
// sign flipped: replaying year 2 on year 5's choices is wrong in exactly the way
// replaying it on the single slot was.
// ============================================================================

import { defaultDecisionSet } from '../../utils/decisionDefaults';
import type { DecisionSet } from '../../types/simulation';
import type { JsonValue } from '../contract';

export type DecisionHistory = Record<string, JsonValue>;

// A DecisionSet is plain data — numbers, strings, nulls, arrays and nested
// objects. The round trip both converts it and asserts that, so a field that
// ever stops being JSON-safe fails here rather than silently crossing a real
// network as undefined.
export function decisionsToJson(d: DecisionSet): JsonValue {
  return JSON.parse(JSON.stringify(d)) as JsonValue;
}

export function decisionsFromJson(v: JsonValue): DecisionSet {
  return JSON.parse(JSON.stringify(v)) as DecisionSet;
}

/**
 * The year whose decisions govern `yearNumber`: that year if it was locked,
 * otherwise the most recent locked year before it, otherwise none.
 *
 * Exported because the assertion "a missed year is played on the last lock
 * before it" is worth testing directly rather than only through its effects.
 */
export function governingYear(yearNumber: number, history: DecisionHistory | undefined): number | null {
  if (!history) return null;
  let best: number | null = null;
  for (const key of Object.keys(history)) {
    const y = Number(key);
    if (!Number.isFinite(y) || y > yearNumber) continue;
    if (best === null || y > best) best = y;
  }
  return best;
}

/**
 * What a team was playing in `yearNumber`.
 *
 * The carried set is RE-STAMPED with the target year rather than used as-is: the
 * engine reads DecisionSet.yearNumber, and handing it another year's number
 * would be a quietly wrong input rather than a loud one.
 */
export function decisionsForYear(yearNumber: number, history: DecisionHistory | undefined): DecisionSet {
  const governing = governingYear(yearNumber, history);
  if (governing === null) return defaultDecisionSet(yearNumber);
  const d = decisionsFromJson(history![String(governing)]);
  return { ...d, yearNumber };
}
