# Cholla

Cholla is a product-agnostic control plane that lets independent Codex sessions coordinate through GitHub while reconstructing product and architecture context from a monorepo.

Cholla does **not** contain the roadmap, architecture, package map, or delivery state of the product it supports. A consumer monorepo owns those facts in `.cholla/project.json`, versioned documents, code, tests, ADRs, and GitHub. Cholla supplies schemas, workflows, skills, and safe GitHub operations.

```text
Consumer monorepo                    GitHub
product + architecture               work + discussion + acceptance
          \                           /
           \                         /
            Cholla control plane
       context / lease / handoff / acceptance
```

- Repository: normative product and technical knowledge.
- GitHub: work state, coordination, traceability, and acceptance.
- Codex session: ephemeral execution; never institutional memory.
- Cholla: generic protocol and tooling; never product source of truth.

## Development

```bash
bun run check
bun run cholla help
```

Install the files under `blueprint/` in a consumer repository, define `.cholla/project.json` using [`docs/project-contract.md`](docs/project-contract.md), then run Cholla against that repository.

## Design

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/project-contract.md`](docs/project-contract.md)
- [`docs/agent-model.md`](docs/agent-model.md)
- [`docs/github-control-plane.md`](docs/github-control-plane.md)
- [`docs/rollout.md`](docs/rollout.md)
