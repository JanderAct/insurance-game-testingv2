// The instance-ID hash, shared by the solo game and the session layer.
//
// ⚠ IT LIVES HERE RATHER THAN IN EITHER CALLER, AND NOT IN src/utils. A
// multiplayer room builds its instance from the same seed string the solo game
// does, so the two must hash it identically — a second copy of these six lines
// would let a solo game and a session game on the SAME seed quietly diverge into
// different instances the first time either was touched. It is not engine code
// and does not belong in src/utils; it was in App.tsx, where exporting it made
// that file export a non-component. So it sits between the two, owned by
// neither.

export function seedFromInstanceId(id: string): number {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash) ^ id.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash;
}
