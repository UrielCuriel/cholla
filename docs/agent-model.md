# Agent execution model

Each independent session selects one configured profile, reconstructs context, obtains one lease, works within authority, persists evidence and leaves enough state for a fresh session to continue. Profiles are conceptual authorities, not filesystem ownership.

## Skills

- `cholla-work`: bootstrap context, select work and request/renew/release leases.
- `cholla-handoff`: persist coordination, blockers, discovered work and decisions.
- `cholla-acceptance`: independently verify evidence and accept/reject work.
- `cholla-delegate`: scope parallel subagents and consolidate their results.

Skills are interfaces to the kernel and project contract. They do not store state or duplicate product policy.

## Subagents

Subagents are temporary parallel compute inside one accountable session.

1. The parent retains the GitHub lease and final responsibility.
2. Each delegation states delegation ID, parent lease, scope, allowed read/write sets, applicable contracts/invariants, expected evidence and merge authority.
3. A child cannot expand scope, modify shared contracts, escalate to humans, mutate GitHub or accept the parent's work unless explicitly delegated and policy permits it.
4. Concurrent write sets must be disjoint; shared contracts require a coordination plan.
5. The child returns a result envelope: findings, changes/evidence, decisions, discovered work and conflicts.
6. The parent persists anything needed after the session. A final subagent message is not institutional memory.
7. Work with its own lifecycle, blocker or downstream consumer becomes a separate GitHub responsibility.

An in-session review subagent improves quality but never satisfies independent acceptance when policy requires a separate actor/session.

Before ending, the parent checks for decisions, blockers, handoffs or discovered work that exist only in conversation and persists those with lasting value.
