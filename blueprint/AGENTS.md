# Cholla-enabled repository

Use `.cholla/project.json` to discover product-owned knowledge and profile authority. Conversation history and subagent messages are not institutional memory.

When the user asks to create a feature, task, initiative or milestone, start with the `product-owner` custom agent and the `cholla-product-owner` skill. The Product Owner reconstructs context, consults `architect` and relevant specialists, persists the GitHub work graph, then delegates eligible tasks to local custom agents. Planning must exist in GitHub before implementation begins.

Before implementation, use `cholla-work` to obtain a granted lease. Read sources progressively and reconstruct parent outcome, criteria, constraints, contracts, affected packages, dependencies and evidence. Stop on a lease collision.

Use local subagents for bounded parallel work. The parent supplies read/write/contract sets and remains accountable. Do not execute overlapping writes concurrently or treat a subagent message as acceptance. Every agent persists decisions, blockers, discovered work, handoffs and evidence in the repository or GitHub.

Repository documents and accepted ADRs remain authoritative when GitHub summarizes them. GitHub is the control plane for work state, not the source of normative product or architecture knowledge.
