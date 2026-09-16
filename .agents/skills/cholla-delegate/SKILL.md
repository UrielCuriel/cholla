---
name: cholla-delegate
description: Plan and control bounded parallel work by temporary subagents under a parent Cholla lease. Use when independent research, implementation slices, or review can safely proceed concurrently.
---

# Cholla Delegate

Delegate only bounded work that advances the parent's claimed responsibility. For each child provide a delegation ID and parent lease, objective and non-goals, allowed read/write/contract sets, applicable sources and invariants, authority limits, expected evidence and merge authority.

Do not run children concurrently when write or contract sets overlap unless an explicit coordination order removes the conflict. A child cannot expand authority, claim unrelated GitHub work, escalate to humans, accept the parent work or make normative decisions.

Require a result envelope containing findings, changes/evidence, decisions proposed, discovered work and conflicts. The parent reviews and integrates results. Persist only information that must survive or affects coordination; subagent messages themselves are ephemeral.
