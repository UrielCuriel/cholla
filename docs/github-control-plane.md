# GitHub control plane

The default semantic hierarchy is `Milestone -> Initiative -> Capability -> Task -> Pull Request -> Acceptance`. Native sub-Issues/relationships are preferred; durable links are the fallback. PRs contain concrete monorepo changes, not architectural decisions that belong in ADRs/design docs.

## Operational dimensions

- `type:*`: initiative, capability, task, decision, quality.
- `area:*`: consumer-defined architectural areas.
- `profile:*`: accountable conceptual authority.
- `priority:*`: ordering among eligible work.
- workflow: ready, leased/in-progress, blocked, needs-decision, review-ready, accepted/done.

Labels or Project fields are repairable projections of versioned Cholla events, not an implicit source of truth.

## Lease protocol

The client posts a versioned lease request containing an idempotency key, verified GitHub actor, session, profile and expiry. A single-writer coordinator serializes requests per work item, checks eligibility/authority, increments a fencing generation and posts grant or denial. Only then does work begin. Expiry/release is explicit and the reconciler repairs partial label/assignment projections.

Direct read-comment-read-assignment sequences are forbidden because they cannot exclude concurrent sessions.

## Handoff, blocker and decision

A handoff records From, To, Type, Context, Impact, Required action, Blocking condition, Evidence and Related work. The receiving profile must be able to discover it. A blocker records failed condition, dependency/owner, evidence and next check. Human escalation is reserved for product direction, irreversible architecture, invariant conflict, material security/destructive risk or owner-only information; it includes alternatives, trade-offs and a recommendation.

Resolving a blocker is an explicit, authorized attestation rather than a text
inference. `cholla unblock` persists a `cholla:unblock:v1` `blocker-resolved`
event containing resolver and target profiles, session, correlation, evidence,
resolution, verified GitHub actor, timestamp, and the SHA-256 of the exact latest blocker comment. A
legacy label-only blocker uses `legacyBlocked: true`. The event is written before
the disjoint projection that adds `ready` and removes `blocked`; retries repair a
partial projection without duplicating the event. A changed blocker, live lease,
assignment, pending handoff, human escalation, or conflicting workflow state
fails closed. The transition never grants a lease or changes an assignee.

Normative decisions must link to a repository artifact. Discoveries outside the active work chain become separate work rather than silent scope growth.

## Acceptance

The verifier checks criteria independently and links commands, CI checks and artifacts. `done` requires accepted evidence. The implementing actor/session cannot accept its own work. An in-session subagent is not independent.
