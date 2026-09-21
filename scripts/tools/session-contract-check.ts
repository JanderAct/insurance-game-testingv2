// ============================================================================
// THE SESSION CONTRACT HARNESS — the closest thing to a gate this layer gets.
//
// ⚠ WHY THIS IS NOT IN scripts/diagnostics. The gate manifest asserts that every
// file in that directory is in exactly one tier, and the 68 gates plus both
// baselines exist to hold a DETERMINISTIC ENGINE still. This checks a session
// layer: tokens, claims, redaction and carry-forward. It shares no baseline with
// them and putting it there would either fail the manifest check or dilute what
// a green sweep means. It runs on its own:
//
//   npx tsx scripts/tools/session-contract-check.ts
//
// WHAT IT IS FOR. The failure modes of a session layer are not numeric drift —
// they are a refresh that locks the real driver out of their own team, a host
// table that loses a lock to a race, a team silently reverted to engine defaults
// because it missed a deadline, and one team's decisions visible to another.
// Each of those is an assertion below.
//
// It drives the localStorage implementation behind a memory shim, so it tests
// the contract, not the browser.
// ============================================================================

import { LocalSessionTransport } from '../../src/session/localTransport';
import { isSessionError, type SessionErrorCode, type JsonValue } from '../../src/session/contract';
import type { CoverageLine } from '../../src/types/simulation';

// ---------------------------------------------------------------- shim

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(k: string): string | null { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
}

(globalThis as unknown as { localStorage: unknown }).localStorage = new MemoryStorage();

// ---------------------------------------------------------------- asserts

const failures: string[] = [];
let checks = 0;

function ok(cond: boolean, what: string): void {
  checks++;
  if (!cond) failures.push(what);
}

function eq<T>(actual: T, expected: T, what: string): void {
  checks++;
  if (actual !== expected) failures.push(`${what}: expected ${String(expected)}, got ${String(actual)}`);
}

// Assert a call rejects with a specific code. A session layer's error codes are
// what every UI branches on, so a wrong code is a real defect, not a detail.
async function rejects(p: Promise<unknown>, code: SessionErrorCode, what: string): Promise<void> {
  checks++;
  try {
    await p;
    failures.push(`${what}: expected rejection ${code}, but it resolved`);
  } catch (e) {
    if (!isSessionError(e)) failures.push(`${what}: threw a non-SessionError: ${String(e)}`);
    else if (e.code !== code) failures.push(`${what}: expected ${code}, got ${e.code}`);
  }
}

// ---------------------------------------------------------------- fixture

const TEAMS = ['Harbour Mutual', 'Cedar Valley', 'Tri-County'];

function transport() {
  return new LocalSessionTransport({ latencyMs: 0 });
}

async function freshRoom(t: LocalSessionTransport) {
  return t.createRoom({
    seed: 'MAMC6EA4',
    yearCount: 3,
    startingYear: 2026,
    eventName: 'Ripple Game',
    expectedTeams: 3,
    shocks: [{ shockId: 'pandemic', yearNumber: 2 }],
  });
}

// Every team in the fixture joins WC-only unless a check says otherwise, so a
// test that cares about lines sets them explicitly and the rest stay comparable.
const WC: CoverageLine[] = ['WC'];


const decisionsFor = (year: number, marker: string): JsonValue =>
  ({ yearNumber: year, marker } as JsonValue);

// ---------------------------------------------------------------- run

async function main(): Promise<void> {
  // ---- createRoom ------------------------------------------------------
  {
    const t = transport();
    const created = await freshRoom(t);

    ok(/^[A-Z2-9]{6}$/.test(created.code), 'room code is six unambiguous characters');
    ok(created.hostToken.length >= 16, 'host token is not guessable-short');
    eq(created.room.currentYear, 1, 'a new room starts on year 1');
    eq(created.room.status, 'lobby', 'a room with nobody joined is in lobby');
    // ⚠ A ROOM OPENS EMPTY NOW. Teams are created by joining, because a team's
    // name and its lines are one act of setup performed by the team itself.
    eq(created.room.teams.length, 0, 'a new room has no teams — they are created by joining');
    eq(created.room.expectedTeams, 3, 'the room carries how many teams the host expects');
    eq(created.room.eventName, 'Ripple Game', 'the room is named for the EVENT, not a pool');

    // The shock list is CARRIED. Nothing consumes it yet — see the note in
    // contract.ts — but it must survive the round trip or the seam that lands
    // later will have nothing to read.
    eq(created.room.shocks.length, 1, 'the room carries its shock list');
    eq(created.room.shocks[0].shockId, 'pandemic', 'the carried shock keeps its catalog id');
    eq(created.room.shocks[0].yearNumber, 2, 'the carried shock keeps its fire year');

    // ⚠ A ROOM VIEW MUST NEVER CARRY THE HOST TOKEN. It is handed back once at
    // creation and is the only thing standing between a player and the advance
    // control.
    ok(!JSON.stringify(created.room).includes(created.hostToken), 'the room view never discloses the host token');

    await rejects(
      t.createRoom({ seed: 's', yearCount: 0, startingYear: 2026, eventName: 'p', expectedTeams: 3, shocks: [] }),
      'INVALID_REQUEST', 'a zero-year game is refused',
    );
    await rejects(
      t.createRoom({ seed: 's', yearCount: 3, startingYear: 2026, eventName: 'p', expectedTeams: 0, shocks: [] }),
      'INVALID_REQUEST', 'a room expecting no teams is refused',
    );
    await rejects(t.read({ code: 'ZZZZZZ' }), 'ROOM_NOT_FOUND', 'an unknown code is not found');
  }

  // ---- join, rejoin, claims -------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);

    const a = await t.join({ code, teamName: TEAMS[0], role: 'player', lines: WC });
    eq(a.rejoined, false, 'a first join is not a rejoin');
    eq(a.teamName, TEAMS[0], 'the joiner gets the team it asked for');

    // ⚠ THE FAILURE MODE THIS EXISTS FOR. A refresh must not read as a second
    // person claiming a taken team — that locks the real driver out of their
    // own game for the rest of the session.
    const again = await t.join({ code, teamName: TEAMS[0], role: 'player', token: a.teamToken });
    eq(again.rejoined, true, 'the same token returning to the same team is a rejoin');
    eq(again.teamToken, a.teamToken, 'a rejoin keeps the original token rather than issuing a new one');

    await rejects(
      t.join({ code, teamName: TEAMS[0], role: 'player', lines: WC }),
      'TEAM_TAKEN', 'a different browser cannot take a name already in the room',
    );
    // ⚠ THE INVERSE OF THE OLD RULE. A name nobody has used is not an error for
    // a player — it is how a team comes into being.
    const invented = await t.join({ code, teamName: 'Nobody FC', role: 'player', lines: WC });
    eq(invented.teamName, 'Nobody FC', 'a player names its own team into existence');
    await rejects(
      t.join({ code, teamName: 'Nobody FC', role: 'player', lines: WC }),
      'TEAM_TAKEN', 'a second player cannot reuse a name already in the room',
    );
    await rejects(
      t.join({ code, teamName: 'Ghost FC', role: 'viewer' }),
      'TEAM_NOT_FOUND', 'a viewer cannot watch a team that does not exist',
    );

    // A viewer never claims, so landing as a viewer by accident blocks nobody —
    // and any number of people may watch the same team. The team has to exist
    // first now, so a player creates it.
    const driver = await t.join({ code, teamName: TEAMS[1], role: 'player', lines: WC });
    const v1 = await t.join({ code, teamName: TEAMS[1], role: 'viewer' });
    const v2 = await t.join({ code, teamName: TEAMS[1], role: 'viewer' });
    ok(v1.teamToken !== v2.teamToken, 'two viewers of one team get distinct tokens');
    ok(v1.teamToken !== driver.teamToken, "a viewer's token is not the driver's");
    const afterViewers = await t.read({ code, token: hostToken });
    const watched = afterViewers.room.teams.find(x => x.name === TEAMS[1])!;
    eq(watched.joined, true, 'the team is joined because its PLAYER joined it');
    eq(afterViewers.room.teams.length, 3, 'watching adds no team row');

    await rejects(
      t.submit({ code, token: v1.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'viewer') }),
      'BAD_TOKEN', 'a viewer token cannot submit',
    );
    await rejects(t.read({ code, token: 'not-a-real-token' }), 'BAD_TOKEN', 'a forged token is rejected');
  }

  // ---- submit, lock, authority ----------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const players = [];
    for (const name of TEAMS) players.push(await t.join({ code, teamName: name, role: 'player', lines: WC }));

    const s = await t.submit({ code, token: players[0].teamToken, yearNumber: 1, decisions: decisionsFor(1, 'y1-a') });
    eq(s.room.teams[0].locked, true, 'a submit locks that team for the current year');
    eq(s.room.teams[1].locked, false, 'one team locking does not lock another');

    await rejects(
      t.submit({ code, token: players[1].teamToken, yearNumber: 2, decisions: decisionsFor(2, 'early') }),
      'WRONG_YEAR', 'decisions for a year the room is not on are refused',
    );

    // ⚠ AUTHORITY IS ENFORCED, NOT HIDDEN. The player's screen has no advance
    // button, but that is a UI fact; this is the one that matters.
    await rejects(
      t.advance({ code, token: players[0].teamToken }),
      'NOT_HOST', 'a team token cannot advance the year',
    );
    await rejects(t.advance({ code, token: 'nope' }), 'BAD_TOKEN', 'a forged token cannot advance the year');

    const adv = await t.advance({ code, token: hostToken });
    eq(adv.currentYear, 2, 'the host advances the room to year 2');
    const afterAdv = await t.read({ code, token: hostToken });
    ok(afterAdv.room.teams.every(x => !x.locked), 'advancing clears every teamlock for the new year');
    eq(afterAdv.room.teams[0].lockedYear, 1, 'the year a team last locked survives the advance');
  }

  // ---- carry-forward ---------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player', lines: WC });

    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'deliberate') });
    await t.advance({ code, token: hostToken });

    // ⚠ THE WHOLE POINT OF CARRY-FORWARD. The team did NOT lock for year 2. What
    // it gets back must still be the deliberate choice it made in year 1 —
    // reverting to engine defaults here would silently undo a decision the team
    // made on purpose, and it would look like the team had chosen the default.
    const mine = await t.read({ code, token: p.teamToken });
    eq(mine.room.currentYear, 2, 'the room moved on to year 2');
    eq(mine.room.teams[0].locked, false, 'the team has not locked for year 2');
    ok(mine.you.lastDecisions !== undefined, 'an unlocked team still has its last submitted decisions to carry');
    eq((mine.you.lastDecisions as { marker: string }).marker, 'deliberate', 'the carried decisions are the last DELIBERATE ones, not defaults');
    eq(mine.you.lastDecisionsYear, 1, 'the carried decisions know which year they came from');
  }

  // ---- results ---------------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player', lines: WC });

    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'y1') });
    await t.advance({ code, token: hostToken });

    // A result is for a year already processed, so it arrives for a year BEHIND
    // the room's current one. That is the normal case, not an error.
    const posted = await t.submit({ code, token: p.teamToken, yearNumber: 1, result: { surplus: 1234 } as JsonValue });
    eq(posted.room.teams[0].resultYear, 1, 'a result for a completed year is accepted');
    eq((posted.you.lastResult as { surplus: number }).surplus, 1234, 'the posting team reads its own result back');

    await rejects(
      t.submit({ code, token: p.teamToken, yearNumber: 9, result: { surplus: 0 } as JsonValue }),
      'WRONG_YEAR', 'a result from the future is refused',
    );
    await rejects(
      t.submit({ code, token: p.teamToken, yearNumber: 2 }),
      'INVALID_REQUEST', 'a submit carrying neither decisions nor a result is refused',
    );
  }

  // ---- redaction -------------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const p0 = await t.join({ code, teamName: TEAMS[0], role: 'player', lines: WC });
    const p1 = await t.join({ code, teamName: TEAMS[1], role: 'player', lines: WC });
    const viewer = await t.join({ code, teamName: TEAMS[0], role: 'viewer' });

    await t.submit({ code, token: p0.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'secret-a') });
    await t.submit({ code, token: p1.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'secret-b') });

    const asHost = await t.read({ code, token: hostToken });
    eq(asHost.you.role, 'host', 'the host token reads as the host');
    eq(asHost.room.teams[0].locked, true, 'the host sees the first team has locked');
    eq(asHost.room.teams[1].locked, true, 'the host sees the second team has locked');
    // A third team joins but does not lock, so the host has something
    // outstanding to see. It cannot simply be absent now — a team that never
    // joined has no row at all.
    const p2 = await t.join({ code, teamName: TEAMS[2], role: 'player', lines: WC });
    const withThird = await t.read({ code, token: hostToken });
    eq(withThird.room.teams.find(x => x.name === TEAMS[2])!.locked, false,
       'the host sees a joined-but-unlocked team as outstanding');
    ok(p2.teamToken.length > 0, 'the third team holds a token of its own');
    // ⚠ PRESENCE AND PROGRESS, NEVER CONTENT. The host needs to know WHO has
    // locked, not WHAT they chose; a host view that carried it would be one
    // render away from projecting another team's hand onto a shared screen.
    ok(!JSON.stringify(asHost).includes('secret-a'), "the host view does not carry a team's decisions");

    const asP0 = await t.read({ code, token: p0.teamToken });
    eq((asP0.you.lastDecisions as { marker: string }).marker, 'secret-a', 'a player reads its own decisions back');
    ok(!JSON.stringify(asP0).includes('secret-b'), "a player cannot see another team's decisions");

    const asViewer = await t.read({ code, token: viewer.teamToken });
    eq(asViewer.you.role, 'viewer', 'a viewer token reads as a viewer');
    eq(asViewer.you.teamName, TEAMS[0], 'a viewer is bound to the team it watches');
    ok(!JSON.stringify(asViewer).includes('secret-b'), 'a viewer sees only the team it watches');

    const anon = await t.read({ code });
    eq(anon.you.role, 'anonymous', 'a tokenless read is anonymous');
    eq(anon.room.teams.length, 3, 'an anonymous caller still sees the roster, to pick a team from');
    ok(!JSON.stringify(anon).includes('secret-a'), 'an anonymous caller sees no decisions at all');
  }

  // ---- team-chosen lines -----------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);

    const wcOnly = await t.join({ code, teamName: 'WC Only', role: 'player', lines: ['WC'] });
    const triple = await t.join({ code, teamName: 'All Three', role: 'player', lines: ['Property', 'WC', 'GL'] });

    eq(wcOnly.lines.join(','), 'WC', 'a team gets exactly the lines it asked for');
    // Canonical order regardless of click sequence, so two teams with the same
    // choice compare equal everywhere they are shown.
    eq(triple.lines.join(','), 'WC,GL,Property', 'lines come back in canonical WC/GL/Property order');

    const asHost = await t.read({ code, token: hostToken });
    const rowOf = (n: string) => asHost.room.teams.find(x => x.name === n)!;
    eq(rowOf('WC Only').lines.join(','), 'WC', "the host's table carries each team's lines");
    eq(rowOf('All Three').lines.join(','), 'WC,GL,Property', 'teams in one room may play different books');

    // ⚠ THERE IS NO MENU ANY MORE, AND THAT IS THE ASSERTION. Every room offers
    // all three lines; the host does not constrain the choice. What is still
    // refused is a set that is empty or not made of coverage lines.
    const narrow = await t.createRoom({
      seed: 's', yearCount: 3, startingYear: 2026, eventName: 'p',
      expectedTeams: 2, shocks: [],
    });
    const anyLines = await t.join({ code: narrow.code, teamName: 'Greedy', role: 'player', lines: ['WC', 'GL'] });
    eq(anyLines.lines.join(','), 'WC,GL', 'any room permits any combination of the three lines');

    // ⚠ expectedTeams BINDS NOTHING. The host guessed two; a third team must
    // still get in, or a room where more people turn up than expected is broken
    // by an estimate made before anyone arrived.
    await t.join({ code: narrow.code, teamName: 'Second', role: 'player', lines: ['WC'] });
    const third = await t.join({ code: narrow.code, teamName: 'Third', role: 'player', lines: ['WC'] });
    eq(third.rejoined, false, 'a team beyond expectedTeams still joins');
    const overfull = await t.read({ code: narrow.code, token: narrow.hostToken });
    eq(overfull.room.teams.length, 3, 'the room holds more teams than the host expected');
    eq(overfull.room.expectedTeams, 2, 'and the expectation is unchanged by that');

    await rejects(
      t.join({ code, teamName: 'Empty', role: 'player', lines: [] }),
      'INVALID_REQUEST', 'a team must play at least one line',
    );
    await rejects(
      t.join({ code, teamName: 'Lineless', role: 'player' }),
      'INVALID_REQUEST', 'a first join without lines is refused',
    );

    // ⚠ FIXED ONCE CHOSEN, AND THE TRANSPORT IS WHAT MAKES THAT TRUE. Changing
    // them would restart the team's book — its pre-game, roster and claim
    // history are all a function of the lines it opened with.
    await rejects(
      t.join({ code, teamName: 'WC Only', role: 'player', token: wcOnly.teamToken, lines: ['WC', 'GL'] }),
      'LINES_LOCKED', 'a rejoin asking for different lines is refused',
    );
    const back = await t.join({ code, teamName: 'WC Only', role: 'player', token: wcOnly.teamToken });
    eq(back.rejoined, true, 'a rejoin without lines is still a rejoin');
    eq(back.lines.join(','), 'WC', 'a rejoin returns the lines chosen originally');
    const same = await t.join({ code, teamName: 'WC Only', role: 'player', token: wcOnly.teamToken, lines: ['WC'] });
    eq(same.lines.join(','), 'WC', 'a rejoin restating the SAME lines is accepted');

    // A viewer needs the watched team's lines, or it cannot build the same game.
    const watcher = await t.join({ code, teamName: 'All Three', role: 'viewer' });
    eq(watcher.lines.join(','), 'WC,GL,Property', "a viewer is handed the watched team's lines");
    const asWatcher = await t.read({ code, token: watcher.teamToken });
    eq((asWatcher.you.lines ?? []).join(','), 'WC,GL,Property', "read gives a viewer the watched team's lines");

    const asPlayer = await t.read({ code, token: wcOnly.teamToken });
    eq((asPlayer.you.lines ?? []).join(','), 'WC', 'read gives a player its own lines');
  }

  // ---- completion ------------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t); // yearCount 3
    await t.advance({ code, token: hostToken }); // -> 2
    await t.advance({ code, token: hostToken }); // -> 3
    const last = await t.advance({ code, token: hostToken }); // -> 4, past the end
    eq(last.room.status, 'complete', 'a room past its last year reads as complete');
    await rejects(t.advance({ code, token: hostToken }), 'GAME_COMPLETE', 'a complete game cannot advance again');
  }

  // ---- fallibility -----------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);

    // ⚠ EVERY CALL CAN FAIL, AND THE UI HAS TO HAVE BEEN BUILT FOR THAT. This is
    // the mechanism that lets a loading spinner and an error state be walked
    // now, against a fake network, rather than discovered against a real one.
    t.faults.failNext();
    await rejects(t.read({ code, token: hostToken }), 'TRANSPORT_FAILURE', 'an injected fault fails the next call');

    const after = await t.read({ code, token: hostToken });
    eq(after.room.code, code, 'the call after an injected fault succeeds again');

    t.faults.failAll('TRANSPORT_FAILURE');
    await rejects(t.read({ code, token: hostToken }), 'TRANSPORT_FAILURE', 'failAll holds the error state');
    await rejects(t.advance({ code, token: hostToken }), 'TRANSPORT_FAILURE', 'failAll applies to every endpoint');
    t.faults.clear();
    const recovered = await t.read({ code, token: hostToken });
    eq(recovered.room.code, code, 'clearing the fault restores the transport');

    // A retryable failure is what a UI is allowed to retry silently; a refused
    // request is what it must report. Keeping them distinguishable matters more
    // once the pipe is real.
    try {
      t.faults.failNext();
      await t.read({ code, token: hostToken });
    } catch (e) {
      ok(isSessionError(e) && e.retryable, 'an injected transport failure is marked retryable');
    }
    try {
      await t.join({ code, teamName: TEAMS[0], role: 'player', lines: WC });
      await t.join({ code, teamName: TEAMS[0], role: 'player', lines: WC });
    } catch (e) {
      ok(isSessionError(e) && !e.retryable, 'a refused request is NOT marked retryable');
    }
  }

  // ---- rev monotonicity ------------------------------------------------
  {
    const t = transport();
    const { code, hostToken } = await freshRoom(t);
    const r0 = await t.read({ code, token: hostToken });
    const p = await t.join({ code, teamName: TEAMS[0], role: 'player', lines: WC });
    const r1 = await t.read({ code, token: hostToken });
    await t.submit({ code, token: p.teamToken, yearNumber: 1, decisions: decisionsFor(1, 'x') });
    const r2 = await t.read({ code, token: hostToken });
    ok(r1.room.rev > r0.room.rev, 'a join bumps the revision');
    ok(r2.room.rev > r1.room.rev, 'a submit bumps the revision');
    eq(r2.room.rev, r0.room.rev + 2, 'the revision counts writes exactly, so a poller can trust it');
  }

  // ---- report ----------------------------------------------------------
  console.log(`session-contract-check: ${checks - failures.length}/${checks} assertions passed`);
  if (failures.length > 0) {
    console.log('');
    for (const f of failures) console.log(`  FAIL  ${f}`);
    process.exit(1);
  }
  console.log('PASS — five endpoints, token authority, redaction, carry-forward and the failure path.');
}

main().catch(e => {
  console.error('session-contract-check threw:', e);
  process.exit(1);
});
