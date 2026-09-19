// ============================================================================
// DECISIONS ACROSS THE WIRE.
//
// ⚠ THE SESSION LAYER NEVER INTERPRETS A DecisionSet. It is carried as an opaque
// JsonValue from submit to read and back, and this file is the ONLY place that
// knows the two are the same thing. That is deliberate: the moment the transport
// understood the engine's decision shape, every engine change would become a
// session-layer change too, and the layer would have grown a second, divergent
// opinion about what a decision is.
//
// ⚠ CARRY-FORWARD SOURCES FROM THE LAST SUBMITTED SET, NEVER FROM DEFAULTS. A
// team that misses a deadline has not changed its mind — it has been busy. Some
// of these fields are deliberate standing policy (Renew All, No New Business,
// funding at expected) and silently resetting them to defaults would undo a
// choice somebody made on purpose, then attribute the consequences to them.
// ============================================================================

import { defaultDecisionSet } from '../../utils/decisionDefaults';
import type { DecisionSet } from '../../types/simulation';
import type { JsonValue } from '../contract';

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

// What a team should be editing for `yearNumber`.
//
// The carried set is RE-STAMPED with the new year rather than used as-is: the
// engine reads DecisionSet.yearNumber, and handing it last year's number would
// be a quietly wrong input rather than a loud one.
export function decisionsForYear(yearNumber: number, carried: JsonValue | undefined): DecisionSet {
  if (carried === undefined) return defaultDecisionSet(yearNumber);
  const d = decisionsFromJson(carried);
  return { ...d, yearNumber };
}
