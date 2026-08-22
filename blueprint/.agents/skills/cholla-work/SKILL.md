---
name: cholla-work
description: Reconstruct product context from a Cholla-enabled monorepo and GitHub, select eligible work for a declared profile, and request or manage its lease. Use when starting or continuing an independent development session.
---

# Cholla Work

Read `.cholla/project.json` and the repository `AGENTS.md`, then run `cholla context --profile <profile>`. Do not infer the profile from a convenient directory; it is an accountable authority selected for the session.

Read returned sources progressively. For a candidate responsibility, reconstruct milestone, parent initiative/capability, outcome, criteria, dependencies, relevant architecture, contracts, invariants, affected packages and required evidence. If a required field is absent, improve the Issue or register a blocker rather than relying on chat context.

Request a lease with a unique session ID and wait for a coordinator grant before editing. A request is not a lease. Stop on collision or denial. Never bypass coordination by changing labels directly.

Keep scope within the claimed responsibility. Cross-package mechanical consequences are allowed; shared contract/invariant changes require the owning profile or a persisted decision. Record discovered out-of-scope work separately.

Before finishing, persist evidence, decisions, blockers, handoffs and discovered work that another session needs. Use `cholla-handoff` when another profile must act and `cholla-acceptance` when implementation is review-ready.

For parallel subagents, use `cholla-delegate`. The parent retains the lease and accountability.
