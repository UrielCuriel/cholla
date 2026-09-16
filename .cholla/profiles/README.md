# Profile instructions

Create one concise file per profile declared in `.cholla/project.json`. Keep product purpose and architecture in their authoritative documents; profile files contain only authority boundaries, escalation rules and non-obvious operating constraints.

Every profile should state:

- decisions it may make;
- responsibilities and evidence it owns;
- decisions it may not make alone;
- applicable invariants and authoritative links;
- coordination triggers with other profiles;
- profile-specific completion conditions.

Do not assign exclusive filesystem ownership. Describe conceptual authority and cross-package coordination.
