# Contributing to Zombonz

Zombonz is built around a deterministic, renderer-independent game core. Changes should preserve that boundary and stay narrowly scoped to the issue being worked.

## Toolchain

Use Node.js `22.12.0`, pinned in `.nvmrc`.

Install dependencies with:

```sh
npm ci
```

Before proposing or merging a change, run:

```sh
npm run check
```

That command typechecks, runs the full automated test suite, and creates a production build.

## Scope and branches

Work from current `main` unless an issue explicitly names another base. Use a dedicated branch and writable checkout for each concurrent task. Do not mix unrelated cleanup, refactors, or feature work into an issue branch.
If several people or agents work in parallel, they must not share one writable checkout. Use separate clones/worktrees and reconcile through Git. Before committing, check branch, status, upstream, and current remote `main` so another valid checkpoint is not overwritten.

## Deterministic gameplay rules

Gameplay truth belongs in `src/core`, not Three.js or browser presentation code. Core state should remain serializable and usable by headless or future host-authoritative runtimes.

When changing gameplay:

- Use fixed simulation ticks for timing rather than wall-clock timers.
- Use seeded deterministic randomness for gameplay decisions.
- Keep stable entity IDs and deterministic tie-breaking.
- Do not make renderer state authoritative.
- Avoid assumptions about a fixed four-player array or lobby size.
- Add tests for deterministic behavior whenever the change can affect simulation results.

Presentation may consume authoritative state and events, but it must not secretly decide damage, purchases, collision, round progression, or similar gameplay outcomes.
## Blockers and ambiguous contracts

If an issue depends on a missing contract, unclear behavior, or incompatible dependency, report the blocker instead of silently inventing a competing architecture. Small clarifications are cheaper than merging two incompatible systems.

When handing work back, state what changed, what was validated, and any remaining limitation or assumption. Research-only tasks may legitimately produce no code commit.

## Definition of done

A task is done when all of the following are true:

1. The issue acceptance criteria are actually met, not merely approximated.
2. Core/presentation and deterministic-simulation boundaries remain intact.
3. Relevant automated tests were added or updated.
4. `npm run check` passes locally.
5. Browser-visible changes receive an appropriate real-browser smoke check.
6. The diff contains no unrelated generated files, lockfile noise, credentials, or other task spillover.
7. The branch is based on or reconciled with current `main`, and the result is committed with a focused message.

CI repeats install, typecheck, tests, and production build for pull requests and pushes to `main`.
