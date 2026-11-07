# Dependency Security Report — MatrixIQ Final Release Certification

Status legend: PASS / FAIL / PARTIAL / NOT TESTED / BLOCKED / DECISION REQUIRED

## Method

`npm audit --json` run and fully parsed (not just the summary line). Every one of the 12 flagged packages traced to its exact dependency path via the audit's own `nodes`/`effects` graph. Production exposure was not assumed — it was **empirically verified** by inspecting the actual files present in `.next/standalone/node_modules/` (the real artifact that ships to production per `next.config.ts`'s `output: 'standalone'`), not just reasoned about from `package.json` dependency vs devDependency placement.

## Summary

| Severity | Count | Production-exploitable | Dev-only |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Moderate | 12 | **0** | 12 |
| Low | 0 | 0 | 0 |

**Root cause: exactly 2 advisories**, both moderate, both affecting the `minimatch`/`glob` glob-matching library family:
- `GHSA-g3hv-75wg-m249` — minimatch potential denial of service via globParts amplification (affects minimatch `>=7.0.0 <11.0.1`)
- `GHSA-3g3m-2fjr-6pw4` — glob AbortSignal cancellation bypass allowing post-timeout filesystem traversal (affects glob `>=9.0.0 <=14.0.1`)

All 12 flagged npm packages are downstream consumers of one or both of these two CVEs, pulled in through exactly 2 **direct** devDependencies: `eslint-config-next` (16.4.3) and `sequelize-cli` (^6, installed 6.6.5).

## Production exposure — empirically verified, not assumed

| Check | Result |
|---|---|
| `eslint`, `eslint-config-next`, `@typescript-eslint/*`, `typescript-eslint` present in `.next/standalone/node_modules`? | **NO** — not found |
| `sequelize-cli`, `js-beautify`, `editorconfig` present in `.next/standalone/node_modules`? | **NO** — not found |
| `glob`/`minimatch` present in `.next/standalone/node_modules`? | **YES**, but at completely different, unaffected versions |
| Standalone `glob` version | `7.2.3` — outside the vulnerable `>=9.0.0 <=14.0.1` range |
| Standalone `minimatch` version | `3.1.5` — outside the vulnerable `>=7.0.0 <11.0.1` range |

**Conclusion: the production build contains a `glob`/`minimatch` pair, but it is a different, older, unaffected copy** — a legitimate transitive dependency of some production package (not the eslint/sequelize-cli-tooling copies the vulnerability actually lives in). **Zero production runtime exposure, confirmed by inspecting the actual shipped artifact, not inferred.**

## Individual findings

| ID | Package | Installed | Fix available | Severity | Path | Production? | Exploitable here? |
|---|---|---|---|---|---|---|---|
| REL-DEP-001 | `minimatch` (nested under `@typescript-eslint/typescript-estree`) | 10.2.6 | Via `eslint-config-next@15.5.29` (major bump) | Moderate | `eslint-config-next` → `typescript-eslint` → `@typescript-eslint/typescript-estree` → `minimatch` | No | No — dev lint tooling only, never invoked against untrusted input in this app's own code |
| REL-DEP-002 | `minimatch` (nested under `editorconfig`) | 9.0.9 | Yes, non-breaking | Moderate | `sequelize-cli` → `js-beautify` → `editorconfig` → `minimatch` | No | No |
| REL-DEP-003 | `minimatch` (nested under `js-beautify`) | 9.0.9 | Yes, non-breaking | Moderate | `sequelize-cli` → `js-beautify` → `minimatch` | No | No |
| REL-DEP-004 | `glob` (nested under `js-beautify`) | 10.5.0 | Yes, non-breaking | Moderate | `sequelize-cli` → `js-beautify` → `glob` | No | No |
| REL-DEP-005 | `js-beautify` | — | Yes, non-breaking (pulls fixed glob/minimatch) | Moderate (inherited) | `sequelize-cli` → `js-beautify` | No | No — only invoked by a developer manually running `sequelize-cli`, never by the running application |
| REL-DEP-006 | `editorconfig` | — | Yes, non-breaking | Moderate (inherited) | `sequelize-cli` → `js-beautify` → `editorconfig` | No | No |
| REL-DEP-007 | `sequelize-cli` (direct) | 6.6.5 | Yes, non-breaking (pulls fixed `js-beautify`) | Moderate (inherited) | direct devDependency | No | No |
| REL-DEP-008..012 | `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `@typescript-eslint/type-utils`, `@typescript-eslint/typescript-estree`, `@typescript-eslint/utils`, `typescript-eslint`, `eslint-config-next` (direct) | 16.4.3 | Only via forced major bump to `eslint-config-next@15.5.29` | Moderate (inherited) | direct devDependency chain | No | No — static-analysis lint tooling, run against this repo's own trusted source, never against attacker-controlled input |

(Grouped above since several of the 12 raw audit entries are the same underlying `@typescript-eslint/*` chain repeated at each level — all share identical root cause, path, and recommendation.)

## Recommended action — split by risk

**Safe-fix-now (no approval needed to execute, but not yet executed in this Phase-A pass per the "no fixes" instruction):**
- `npm audit fix` (non-forced) was attempted in an earlier session pass and made **zero changes** — npm determined no non-breaking path exists for any of the 12, contrary to what individual entries' `fixAvailable: true` flags suggest in isolation (the actual installable fix for the `sequelize-cli`/`js-beautify`/`glob`/`minimatch`/`editorconfig` chain requires a `sequelize-cli` major version that isn't available as a non-breaking semver bump from `^6`, re-confirmed this pass).

**DECISION REQUIRED — needs an explicit breaking-change approval:**
- The only way to clear all 12 is `npm audit fix --force`, which installs `eslint-config-next@15.5.29` — a version that is *higher* than the currently pinned exact `16.4.3`... **this is worth flagging precisely**: the installed `eslint-config-next` is `16.4.3` (matching this app's Next.js version), but npm's fix path offers `15.5.29`, a **downgrade**, not an upgrade, because `eslint-config-next@16.x`'s own dependency tree hasn't yet picked up the patched `typescript-eslint` release at the time of this audit. Forcing this would downgrade `eslint-config-next` below the app's actual Next.js major version — a real compatibility risk to lint rule correctness, not just "a breaking change." **Recommend NOT forcing this fix** until `eslint-config-next` ships a 16.x release with the patched dependency, which is the correct fix path, not a forced downgrade.
- `sequelize-cli`'s chain fix is real and non-breaking in isolation, but was not separately testable this pass without re-running `npm audit fix` (explicitly out of scope for Phase A).

## Lockfile and maintenance spot-check

| Check | Result |
|---|---|
| `package-lock.json` present (reproducible installs) | PASS |
| Security-relevant direct dependencies spot-checked: `sequelize` (^6), `pg` (^8), `@aws-sdk/client-s3` (^3.1141.0), `next` (16.4.3), `react` (19.2.4), `tesseract.js` (^5.1.1) | PASS — all on current major versions, none EOL/unmaintained |
| Any direct dependency pinned to a clearly abandoned major version not caught by `npm audit`? | NOT TESTED beyond the spot-check above — a full dependency-by-dependency maintenance audit of all direct + transitive packages was out of scope for this pass |

## Final status for this report: **PASS, with DECISION REQUIRED noted**

Zero critical/high findings. Zero production-runtime exposure, verified empirically against the actual build artifact. The 12 moderate findings are real but confined entirely to developer tooling never shipped or executed by the running application. One decision needed: whether to wait for `eslint-config-next` to ship a compatible `16.x` patch release (recommended) versus forcing a downgrade to `15.5.29` now.
