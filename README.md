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

## Local installation

Build the standalone executable with Bun 1.4 and expose it globally through Bun's package link:

```bash
bun run link
cholla help
```

The package `bin` points to `dist/cholla`. Re-run `bun run link` after changing the CLI so the compiled executable reflects the latest sources.

Initialize a consumer monorepo from its root. The command preserves existing `AGENTS.md`, discovers product knowledge already present, installs all seven profiles and Cholla skills, and configures Codex's GitHub MCP:

```bash
cholla init --repository OWNER/REPOSITORY --actor GITHUB_LOGIN --apply-github
cholla codex
```

`cholla codex` obtains the current token from `gh auth token`, exposes it only to the child Codex process as `GITHUB_PAT_TOKEN`, and never writes the credential into the repository. In the session, requests for a milestone, feature, or task invoke the product-owner workflow, which persists the work graph in GitHub and delegates bounded tasks to local Codex subagents.

The generated contract is strict `.cholla/project.json`; advanced consumers may instead provide `.cholla/project.json5` for comments and trailing commas. Cholla uses Bun's native Markdown, TOML, YAML, and JSON5 parsers, so initialization adds no document-parser dependencies.

Use `--dry-run` to preview installation. Existing Cholla-managed files with local changes are reported as collisions; use `--force-managed` only after reviewing them. Commands can then be invoked directly:

```bash
cholla doctor
cholla context --profile <profile>
cholla next --profile <profile>
cholla handoff --help
cholla handoff --profile <sender> --issue <number> --to <receiver> --state ready # plus evidence fields
cholla handoff-ack --profile <receiver> --issue <number> --state ready
```

Every command supports `--help` (and `-h`) without requiring configuration or mandatory options. The equivalent `cholla help <command>` form is also available. For machine-readable command discovery, use Bunli's `--llms` or `--llms-full` manifest.

`handoff` records a pending cross-profile transfer. An authorized sender may pass `--state ready` to persist and project the explicit `needs-decision` to `ready` transition; retries reuse the unacknowledged event and repair its labels. The receiving profile acknowledges the latest structured handoff with `handoff-ack`, choosing the state already persisted on the issue: `ready`, `blocked`, or `needs-decision`. Acknowledgment preserves the original event, is safe to retry after partial GitHub mutations, and removes only `handoff:required`; it never promotes blocked or decision-pending work implicitly.

`context` and `next` discover eligible open work across the repository, including work intentionally outside the active product milestone. The milestone remains the scope for active responsibilities and pending handoffs shown by `context`.

## Design

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/project-contract.md`](docs/project-contract.md)
- [`docs/agent-model.md`](docs/agent-model.md)
- [`docs/github-control-plane.md`](docs/github-control-plane.md)
- [`docs/rollout.md`](docs/rollout.md)
