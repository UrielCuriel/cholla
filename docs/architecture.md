# Cholla architecture

Cholla gives autonomous Codex sessions a durable coordination protocol without embedding the supported product's process or technical model. It is a development control plane, not product runtime.

## Components

1. **Project contract** — the consumer-owned `.cholla/project.json` points to authoritative knowledge and declares profiles.
2. **Context resolver** — loads only the knowledge layers applicable to the profile and active responsibility.
3. **Coordination kernel** — generic WorkItem, Actor, Profile, Lease, Delegation, Handoff, Decision, Evidence and Acceptance primitives.
4. **GitHub adapter** — projects/query milestones, Issues, PRs, checks, labels and structured events.
5. **Agent skills** — expose safe workflows without copying product facts into prompts.
6. **Policy/reconciliation** — denies invalid transitions and detects drift or partial mutations.

```text
Project contract
  -> authoritative product context
  -> active GitHub milestone
  -> responsibility eligible for profile
  -> relevant architecture/packages/contracts/invariants
  -> implementation and evidence
  -> PR + independent acceptance
```

The resolver returns a traceable context bundle, not a copied knowledge warehouse. Product-specific defaults belong in the consumer repository, never Cholla code.

## Enterprise invariants

- One live lease per work item; grants are serialized and carry a fencing generation.
- A caller requests a lease; it never self-grants one through a multi-call client sequence.
- Every mutation is idempotent and attributable to a GitHub actor, session and correlation ID.
- A delegation cannot expand the parent profile or lease authority.
- Independent acceptance requires a different accountable actor/session and an authorized acceptance profile.
- Normative decisions link to versioned ADR/design artifacts.
- Session output needed later has a persistent destination.
- Product secrets never enter configuration, prompts, comments or telemetry.

## Non-goals

Cholla does not define product scope, own monorepo directories, replace ADRs/CI/Projects, or treat conversation/subagent output as memory.
