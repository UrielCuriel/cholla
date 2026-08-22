---
name: cholla-handoff
description: Persist a cross-profile handoff, blocker, discovered work item, decision link, or human escalation through Cholla and GitHub. Use when another accountable session must continue or resolve work.
---

# Cholla Handoff

Confirm the current session holds the responsibility and that the receiver exists in `.cholla/project.json`. A handoff must contain From, To, Type, Context, Impact, Required action, Blocking condition, Evidence and Related work.

Link repository sources and concrete evidence instead of copying normative architecture into the comment. If the handoff changes a shared contract or invariant, link an accepted ADR/design artifact or mark it needs-decision. If it expands product scope, create separate work.

Use `human:required` only for product direction, irreversible/high-cost architecture, unresolved invariant conflict, material security/destructive risk or owner-only information. Include alternatives, trade-offs and a recommendation.

After writing, verify the receiving profile can discover the responsibility and that no needed fact remains only in conversation. Do not produce ceremonial handoffs when no action survives the session.
