# Project Status

**Version:** 3.0.0
**Current phase:** 3.0 — Repository Analyzer delivered (phases A–L)
**Last updated:** 2026-11-20

## Completed work (3.0 — Repository Intelligence)

| Phase | Result |
|---|---|
| Audit | 2.0 features confirmed in code; baseline 185 server + 14 client tests green. Risks noted: sandbox does not block network or reads of user-readable files (unchanged and still stated); single route file (new module got its own router); only 5 Tree-sitter grammars loaded (extended to TS / TSX instead of adding a parser). |
| A. Import | Folder (in place) and ZIP (validated, managed copy); read-only scanner with ignores, .gitignore, link safety, binary / size / secret handling. |
| B. Dashboard | Real metrics, reproducible quality score, distributions, profile, activity, quick actions. |
| C. Static analysis | 25 bug / maintainability / complexity / performance / style / debt rules on Tree-sitter + cross-file checks, plus 6 dependency-manifest rules. |
| D. Security | 16 security rules, secret redaction, sensitive-file detection, optional Ruff / Bandit, disclaimer. |
| E. AI review | Chunked local review (file / function / folder / repo), Q&A, follow-ups, cache, cancel, combined findings, offline fallback; verified with the real model. |
| F–H. Quality, deps, debt | Complexity report, dependency analysis for 5 ecosystems (offline), technical-debt priorities with evidence. |
| I. Git | Read-only status, commits, diffs and change review with protection against malicious repository configuration. |
| J. Findings | Persistent triage (status, notes, verified), fingerprints survive re-analysis, multiple repositories. |
| K. Reports | Markdown + locally rendered PDF. |
| L. Testing | 86 analyzer tests, persistence test, live model test, 9 E2E journeys + phone check; full regression green. |

### Known limitations (3.0)

- **Static analysis is heuristic.** Pattern-based security rules can miss issues and report false positives; confidence levels reflect this, and the UI and reports say so. Undefined-identifier detection is not implemented (it needs full scope / type resolution, e.g. the TypeScript compiler).
- **Unused functions / dependencies** are low-confidence: dynamic calls, framework conventions and tools that load packages implicitly are not visible to a text search.
- **No vulnerability database** is consulted; outdated-package detection is not offered because no reliable offline version source exists.
- **Small model:** `qwen2.5-coder:1.5b` reviews in ~30–60 s per chunk and sometimes misclassifies issues (e.g. SQL injection as "performance"); AI findings are low-confidence until a user verifies them.
- **Semgrep and ESLint** are detected but not run (network rule downloads / executing project configuration). Ruff and Bandit adapters are tested with recorded output but were not installed on this machine.
- **Git:** ZIP imports carry no history; repositories owned by another Windows user may be refused by Git.
- **GitHub integration** is planned only (see ARCHITECTURE.md); no network features were added.

## Completed work (2.0 upgrade)

| Phase | Result |
|---|---|
| 1. Real local AI | Ollama installed by the owner's approval with `qwen2.5-coder:1.5b`. Install / service / model detection, model details and memory advice, JSON-schema structured outputs with Zod validation and a repair retry, streaming with a size cap, time limit and answer-length settings, typed failures with offline fallback. AI path covers generation, conversion, explanation, algorithm, pseudocode, debugging, tests, viva and MCQs. 7 live tests pass against the real model. |
| 2. Offline analysis | Tree-sitter (WebAssembly) structural analysis for all 5 languages; complexity with confidence and reasons; unknown instead of fabricated. |
| 3. Converter | Classes, constructors, methods, maps, sets, exceptions, string methods, slicing; every new construct verified by executing the converted programs. |
| 4. Execution security | Windows sandbox (Job Object + low integrity + no-read-up data folder), built locally with the Windows C# compiler; enforcement proven by tests that deliberately evade the static guard; isolation level reported per run. |
| 5. Playwright E2E | 35 tests in Microsoft Edge against a throw-away database; console / request / overflow / accessibility guards; 3 consecutive green runs. |
| 6. Dashboard | Continue where you left off, compiler availability with sandbox state, engine breakdown — all from real records. |
| 7. Algorithm Studio | +5 algorithms (counting sort, shell sort, jump search, tree traversals, fast exponentiation) with real tracers; sample input / final output panel. |
| 8. Learning | Learning paths, categories, per-question answer storage, revision mode, wrong-answer explanations, difficulty filter; SQLite migration v2. |
| 9. UI / UX | Fixed 36 px horizontal overflow on every page, dropdown widths, pluralisation; skip link; reduced motion; light theme reviewed by screenshots. |
| 10. Final audit | All suites, type checks, build, security review (DNS-rebinding fix, CSP), secrets scan, documentation. |

## Current work

None. Ready for owner review.

## Known issues and limitations

- **Sandbox scope:** programs cannot write your files, start other programs, exceed memory / CPU limits or read CodePilot's data, but they **can read** other files your account can read, and **network access is not blocked by the OS** (administrator firewall rules would be needed). It is not a VM; Windows Sandbox and Docker were not used because they need downloads.
- **Small local model:** `qwen2.5-coder:1.5b` is fast but makes mistakes; every AI result is labelled and can be verified by running. Larger models (3b / 7b) are listed in Settings with their sizes.
- **Offline converter:** procedural code plus classes, maps, sets and exceptions. Inheritance, generics, lambdas, file I/O and pointers to pointers are left as marked comments with warnings. C output for maps / sets is not generated (warning instead).
- **Complexity** is a static estimate. The confidence level says how sure it is; "unknown" is a valid answer.
- Playwright uses the installed Microsoft Edge because the Chromium download from Playwright's CDN failed twice on this network. `PW_CHANNEL=chromium` switches back once that download works.

## Next steps (optional)

1. Try a larger local model (`qwen2.5-coder:3b` or `7b`) if the machine has the memory; no code changes needed.
2. Converter: inheritance and generics.
3. Firewall-based network blocking for sandboxed programs (requires administrator approval once).
4. More visualisers: topological sort, union-find, DP tables.
