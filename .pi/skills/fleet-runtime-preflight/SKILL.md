---
name: fleet-runtime-preflight
description: Diagnose Fleet configuration drift in this repository. Use when an orchestrator blocks before task execution because worktree, report, or selected-skill pointers are missing.
---

# Fleet configuration drift

Observed symptom: run `2026-08-02-starlight-llms-tree-v1` blocked all ten nodes before execution with `Immutable worktree, report directory, selected-skills pointers missing.` Root cause was not isolated; treat this as a diagnostic trigger, not proof that runtime directories need manual creation.

## Diagnose before redispatch

1. Run `node ~/.pi/agent/templates/fleet/validate.mjs .fleet/<run>`. Continue only after it exits 0.
2. Trace captain prompt, orchestrator prompt, Fleet schemas, and validator to their installed package versions. Continue only after they agree on one active contract.
3. Account for every orchestrator prerequisite: immutable worktree location, report destination, and selected-skill pointers. Continue only after each pointer resolves or its responsible runtime creation step is identified.
4. Repair configuration drift in the owning template or re-derive the contract. Redispatch only after preflight succeeds without manually advancing task runtime state or weakening routing.
