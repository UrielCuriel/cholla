# Consumer project contract

The consumer monorepo owns `.cholla/project.json`. Cholla validates its structure but does not prescribe product facts.

```json
{
  "schemaVersion": 1,
  "project": { "name": "Product name", "repository": "owner/repo" },
  "knowledge": { "layers": [
    { "id": "product", "purpose": "North Star", "paths": ["docs/product/north-star.md"], "required": true },
    { "id": "domain-area", "purpose": "One product-defined architecture area", "paths": ["docs/architecture/domain-area.md"], "profiles": ["domain-specialist"] }
  ] },
  "profiles": {
    "domain-specialist": {
      "githubActors": { "users": [], "teams": ["owner/domain-specialists"] },
      "authority": ["Named domain contracts within accepted architecture"],
      "responsibilities": ["Domain implementation and evidence"],
      "exclusions": ["Product scope", "Unilateral cross-cutting architecture"],
      "areas": ["domain-area"],
      "instructions": [".cholla/profiles/domain-specialist.md"],
      "knowledge": ["domain-area"],
      "acceptance": ["unit", "integration", "security"]
    }
  },
  "github": {
    "repository": "owner/repo",
    "activeMilestoneMarker": "<!-- cholla:active -->",
    "taxonomy": { "types": ["initiative", "capability", "task", "quality"], "priorities": ["P0", "P1", "P2"] },
    "labels": {
      "ready": "status:ready", "inProgress": "status:in-progress",
      "blocked": "status:blocked", "needsDecision": "status:needs-decision",
      "handoffRequired": "handoff:required", "humanRequired": "human:required",
      "accepted": "status:accepted", "profilePrefix": "profile:",
      "areaPrefix": "area:", "typePrefix": "type:", "priorityPrefix": "priority:"
    }
  },
  "policy": { "acceptanceProfile": "quality-engineer", "requireIndependentAcceptance": true, "claimTtlHours": 24 }
}
```

Paths are repository-relative and may not escape its root. Profiles map authority to GitHub users or `org/team-slug` teams and state positive authority plus exclusions. Profile instructions refine behavior but cannot override repository-wide invariants. A milestone is active only when explicitly marked. Label spelling is configurable; Cholla relies on semantics, not names.
