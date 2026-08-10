---
description: Drain eligible ready-for-agent GitHub issues through implementation, review, push, and PR
argument-hint: "[max-tickets]"
---

Drain GitHub issues for this repository. Ticket cap for this invocation: `${1:-all}`.

Invocation grants context-bound authority to assign eligible issues to current GitHub user, comment, change triage labels, create branches, push those branches, and open pull requests. Never auto-merge, close issues directly, delete branches, force-push, or mutate blocked/ineligible issues.

<!-- ponytail: GitHub is state store; no private ledger, scheduler, or crash recovery. Upgrade to full Ticket Drainer only when repeated unattended recovery or multi-provider scheduling is needed. -->

## Preconditions

1. Read `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `CODING_STANDARDS.md`, and repository `AGENTS.md` files.
2. Require GitHub tracker, authenticated `gh`, configured `origin`, root `CODING_STANDARDS.md`, and available `implementer`, `reviewer`, `frontier-implementer`, and `frontier-reviewer` subagents.
3. Require current branch `main`, synchronized with `origin/main` by fast-forward only, with clean tracked and untracked working tree. Stop instead of stashing, deleting, resetting, or overwriting anything.
4. Keep one source writer and one ticket checkout active at a time. Main agent owns triage/orchestration and external GitHub actions; implementation child owns source edits and commits. Reviewers are read-only.

## Triage loop

Maintain an in-memory `attempted` issue-number set for this invocation. Repeat until ticket cap reached or no eligible issue remains:

1. List open issues labeled `ready-for-agent` from configured repository.
2. For each candidate, fetch full issue, assignee, linked PRs, native blockers, and sub-issues through GitHub API. A candidate is eligible only when:
   - issue remains open and `ready-for-agent`;
   - unassigned or assigned to current GitHub user;
   - no linked open PR already delivers it;
   - every native blocker is closed;
   - it has no open sub-issues (spec/container issues are not implementation tickets);
   - issue number is not in `attempted`.
3. Select lowest issue number among eligible candidates. This gives deterministic dependency-first behavior for `/to-tickets` output. Never infer away a native blocker.
4. If no candidate qualifies, end successfully and report open ready issues skipped because blocked, container-only, assigned elsewhere, already under PR, or attempted.

## Deliver one ticket

1. Add selected issue to `attempted`. Re-read it immediately before external mutation; eligibility drift means skip without mutation.
2. Assign `@me` and comment that drain claimed the issue. Create `agent/issue-<number>-<slug>` from current `origin/main`. Existing conflicting local/remote branch without matching open PR is `ESCALATE`; preserve it untouched.
3. Route by actual surface:
   - `frontier-implementer` + `frontier-reviewer` for auth, secrets, schema/migration, public API, money, deletion, irreversible output, or security-sensitive paths;
   - `implementer` + `reviewer` otherwise.
   Route never downgrades during delivery.
4. Spawn one fresh async implementer in current ticket branch. Give issue URL, branch, `CODING_STANDARDS.md`, explicit success criteria from issue, required checks, and these boundaries: sole source writer; no subagents; no push/PR/issue mutation; stop on unapproved product/architecture scope; commit completed work. Wait for this run because drain is run-to-completion.
5. Require handoff containing verdict `PASS | FAIL | BLOCKED | ESCALATE`, commit SHA, changed paths, commands with exit codes, residual risks, and decisions needed. Malformed handoff is `FAIL`.
6. On implementer `PASS`, launch two fresh read-only reviewers in parallel against `origin/main...HEAD`:
   - Standards axis: `CODING_STANDARDS.md` plus repository rules and smell baseline.
   - Spec axis: selected issue acceptance criteria plus focused executable checks.
   Use same routing class selected above. Require `PASS | FAIL | ESCALATE`, evidence-backed findings, commands, and residual risk.
7. If either reviewer returns actionable `FAIL`, launch one fresh implementer of same class with reviewer findings. Maximum two fix rounds, each followed by both fresh review axes. Optional polish does not keep loop alive.
8. Run repository checks required by issue and scripts introduced by implementation. Checks must exercise observable behavior; typecheck/lint alone cannot prove artifact writes or rendered output.

## Publish or fail closed

After implementation, both review axes, and checks pass:

1. Push ticket branch with normal `git push -u origin HEAD`.
2. Open PR to `main`; title references issue, body summarizes behavior and validation, and includes `Closes #<number>`.
3. Remove `ready-for-agent`, keep issue open for PR merge, and comment with PR URL.
4. Switch back to `main`, fast-forward from `origin/main` only, verify clean tree, then continue triage. Dependent tickets remain blocked until GitHub closes blocker through merge.

Failure handling:

- `BLOCKED` or `ESCALATE`: preserve branch/work, comment concise reason without secrets, replace `ready-for-agent` with `ready-for-human`, then continue only if checkout returns clean safely.
- Transient `FAIL`: preserve evidence, comment concise failure, leave `ready-for-agent`, and do not retry same issue during this invocation.
- Dirty tree, ambiguous branch ownership, destructive recovery need, malformed external state, or failed push/PR with uncertain remote effect: stop entire drain. Preserve everything and report exact recovery point.

Finish with counts and pointers: delivered PRs, human-blocked issues, transient failures, skipped candidates, and untouched native blockers.
