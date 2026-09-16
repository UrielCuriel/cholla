# ADR-0001: Cholla work lives in the Cholla repository

- Status: **Proposed**
- Date: 2026-09-15
- Owners: Product Owner and Architect

## Context

Cholla is consumed by other repositories, but its CLI, lifecycle kernel, GitHub adapter, managed workflows, skills, project-contract schema, and architectural decisions are Cholla product artifacts. Planning those changes in a consumer repository couples Cholla delivery to consumer milestones and creates lifecycle events under the wrong contract.

The first affected consumer was `UrielCuriel/saguaro`. Historical events there remain useful evidence, but they cannot authorize, lease, hand off, or accept canonical Cholla work.

## Decision

Work is planned, leased, handed off, accepted, and closed in the repository that owns the changed product or normative document.

Before creating work, Product Owner classifies the intended change:

1. If it changes Cholla source, schemas, workflows, skills, documentation, or lifecycle semantics, the canonical issue and lifecycle live in `UrielCuriel/cholla`.
2. If it changes consumer product behavior, the work remains in that consumer repository.
3. If a Cholla release requires consumer adoption, each repository receives a bounded item linked with owner/repository-qualified references; neither lifecycle is copied into the other.

A redirect freezes the legacy item as provenance. Lease requests, grants, generations, handoffs, blockers, acceptance events, assignments, and workflow labels are not copied. The canonical issue starts a fresh lifecycle under its own repository contract.

Green consumer checks or delivery evidence never constitute Cholla acceptance. Cholla acceptance requires the configured `quality-engineer`, an exact Cholla artifact, and evidence recorded in the Cholla lifecycle.

## Migration inventory

| Legacy source | Canonical Cholla destination | Disposition |
| --- | --- | --- |
| `UrielCuriel/saguaro#73` | `UrielCuriel/cholla#15` | Open product defect; fresh Cholla lifecycle required. |
| `UrielCuriel/saguaro#76` | merged PR `UrielCuriel/cholla#1` | Historical implementation and acceptance; no lifecycle copied. |
| `UrielCuriel/saguaro#123` | merged PR `UrielCuriel/cholla#2` | Historical corrective delivery; no lifecycle copied. |
| `UrielCuriel/saguaro#125` | `UrielCuriel/cholla#7` and paused PR `UrielCuriel/cholla#3` | Rework waits for accepted `UrielCuriel/cholla#4`, `#5`, and `#6`. |
| `UrielCuriel/saguaro#126` | `UrielCuriel/cholla#5` | Fresh Proposed Cholla ADR required; rejected Saguaro ADR is provenance only. |
| `UrielCuriel/saguaro#127` | none | Closed dogfood evidence only; never canonical product work. |
| `UrielCuriel/saguaro#129` | `UrielCuriel/cholla#6` | Fresh Runtime lifecycle after accepted `UrielCuriel/cholla#4` and `#5`. |
| `UrielCuriel/saguaro#130` | `UrielCuriel/cholla#8` | P2 Cholla architecture backlog outside the lifecycle-recovery milestone. |

## Consequences

- Cholla delivery metrics and acceptance become independent of consumer milestones.
- Consumer repositories preserve audit history without advertising foreign work as active product backlog.
- Cross-repository adoption requires explicit linked work rather than implicit dependency inference.
- Bootstrap work may be prepared through a human planning record, but formal Cholla claims begin only after this repository contract is merged and independently accepted.
