# Ricochet Rivals — Codex Agent Instructions

## Project priorities

Ricochet Rivals is a mobile-first, browser-based, turn-based artillery game with single-player and peer-to-peer multiplayer.

Prioritize, in order:

1. Correct gameplay behavior
2. Mobile interaction quality
3. Multiplayer determinism and synchronization
4. Maintainable architecture
5. Regression safety
6. Desktop compatibility
7. Visual polish

Do not sacrifice mobile UX for desktop convenience.

## Main agent role

Act as Lead Engineer and Orchestrator.

For substantial work:

1. Inspect the existing implementation before changing it.
2. Identify affected systems and existing tests.
3. Make a concise implementation plan.
4. Delegate specialist work when it materially improves quality or speed.
5. Avoid overlapping edits between agents.
6. Integrate the result.
7. Run relevant tests, type checks, linting, and builds.
8. Use `test-reviewer` for an independent review after meaningful changes.
9. Fix P0/P1 findings and reasonable P2 findings.
10. Report what changed, verification performed, remaining risks, and the next recommended step.

Do not stop after planning unless implementation is genuinely blocked.

## Agent routing

### repo-scanner

Use for fast, low-risk repository exploration:

- locating implementations
- tracing references
- finding interfaces
- mapping dependencies
- summarizing modules
- identifying affected files
- TODO discovery

Prefer this role over expensive reasoning for simple repository discovery.

### gameplay-engineer

Use when work primarily affects:

- gameplay rules
- projectile physics
- player movement
- aiming and firing
- turn logic
- weapons and items
- damage and HP
- pickups
- gameplay state machines
- player input
- touch controls
- mobile gameplay feel
- deterministic simulation

### network-engineer

Use whenever a change affects shared multiplayer state, including:

- WebRTC / peer-to-peer networking
- signaling assumptions
- host/client authority
- turn synchronization
- state replication
- serialization
- reconnect / disconnect behavior
- duplicate or stale messages
- event ordering
- race conditions
- desync investigation

When a gameplay feature changes shared state, let `gameplay-engineer` and
`network-engineer` analyze their concerns separately. Parallelize only if they
will not edit the same files at the same time.

### test-reviewer

Use after substantial implementation for an independent review.

The reviewer should:

- inspect the diff independently
- identify regressions and missing edge cases
- verify mobile implications
- verify multiplayer implications
- verify state transitions and cleanup
- inspect error handling
- run appropriate tests
- classify findings as P0 / P1 / P2 / P3

The reviewer should normally review rather than implement the original feature.

### escalation-engineer

Do not use routinely.

Escalate only when one or more of these conditions holds:

1. Two targeted repair attempts have failed.
2. The root cause remains ambiguous after investigation.
3. The problem spans several systems.
4. A nondeterministic or timing-dependent bug cannot be isolated.
5. Visual interpretation or computer-use reasoning is central.
6. Runtime behavior contradicts static code inspection.
7. A release-critical architectural decision requires maximum confidence.

Before escalation, gather the original requirement, observed behavior, attempted
fixes, test results, relevant logs, suspected modules, and unresolved hypotheses.
Do not make the escalation agent rediscover established facts.

## Mobile-first verification

Every gameplay or UI change must consider:

- touch target size
- thumb reach
- accidental input
- drag precision
- viewport scaling
- browser chrome
- safe areas
- performance on mobile hardware

Desktop behavior must continue to work, but desktop convenience must not degrade mobile UX.

## Multiplayer verification

Never infer multiplayer correctness from single-player correctness.

For shared state, explicitly verify:

- authority and ownership
- event ordering
- idempotency
- serialization
- reconnect behavior
- duplicate events
- late/stale events
- turn ownership
- state recovery

## Completion contract

A task is complete only when:

- requested behavior exists
- relevant tests pass
- build/type checks pass where applicable
- obvious regressions have been checked
- multiplayer implications were considered where applicable
- mobile implications were considered where applicable
- significant reviewer findings were addressed
