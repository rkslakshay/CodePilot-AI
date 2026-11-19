# Test Report — CodePilot AI 3.0.0

**Date:** 2026-11-20
**Machine:** Windows 11 (16 GB RAM), Node.js 24.19.0, Git 2.55.0, GCC/G++ 6.3.0 (MinGW.org), Java 26.0.1, Python 3.13.3, Microsoft Edge (installed), Ollama with `qwen2.5-coder:1.5b`. Ruff, Bandit, Semgrep and ESLint are **not** installed.

## Pre-publication verification (2026-11-20, staged repository contents)

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| Server tests (`--exclude tests/ollama-live.test.ts`) | 272 / 272 passed |
| Client tests | 14 / 14 passed |
| `npm run build -w client` | Success |
| Playwright E2E | 46 / 46 passed (1 skipped: the on-demand documentation-screenshot generator) |

## Summary

| Suite | Command | Result |
|---|---|---|
| Baseline before 3.0 work | server + client | 185 / 185 and 14 / 14 passed |
| Server, all suites (except live AI) | `npx vitest run --exclude tests/ollama-live.test.ts` in `server/` | **272 / 272 passed** |
| Repository Analyzer + database + API after the final changes (diff parser fix, version bump) | `npx vitest run tests/repo.test.ts tests/database.test.ts tests/api.test.ts` | **134 / 134 passed** |
| Live local AI, repository review | `npx vitest run tests/ollama-live.test.ts -t "repository review"` | **1 / 1 passed** with `qwen2.5-coder:1.5b` (file review + question) |
| Client | `npm test -w client` | **14 / 14 passed** |
| End-to-end (Playwright, Edge) | `npm run e2e` | **46 / 46 passed in 3 consecutive runs** |
| Type checking | `tsc --noEmit` server + client | **0 errors** |
| Production build | `npm run build -w client` | **Success** |

## Repository Analyzer tests (`server/tests/repo.test.ts`, 86 tests)

**Import security**
- Entry-name validation rejects `../`, nested traversal, `/abs`, `C:/…`, UNC, `con.txt`, `:` and NUL; normalises `\` and `./`.
- A malicious archive is rejected over HTTP with `zip_unsafe_path` and **nothing** is written (storage folder count unchanged, no escaped file).
- Symlink entries, encrypted entries, non-ZIP data and truncated archives are rejected; a 101 MB upload returns 413.
- A valid GitHub-style archive imports, skips `.git` / `node_modules`, analyses, and removal deletes CodePilot's copy.

**Folder import and scanning**
- Relative, missing, file, drive-root and system paths are refused; the same folder cannot be imported twice (409).
- Default ignores, `.gitignore` (incl. negation, anchors, `**`, directory-only), binary detection by extension and by content, `.env` flagged and **not read**, `.env.example` not flagged, large files listed but unread, junctions to outside folders not followed.
- Project profile: React / Express / Vitest, full-stack + Node.js + TypeScript + Python + Java + C, entry points, test dirs, docs, package managers.

**Static analysis (exact line numbers)** — the sample repository plants known issues; each expected finding is located by searching the file for its marker, then asserted at that exact line:
- 16 security checks: SQL injection, command injection (JS / Python / Java), eval, hard-coded password, plain HTTP, wildcard CORS, insecure randomness, `dangerouslySetInnerHTML`, pickle / yaml deserialisation, MD5 (Python / Java), `gets`, `strcpy` — with expected severities.
- 28 quality checks: unreachable code, empty catch / except, bare except, loose equality, unused locals, `JSON.parse` / `Integer.parseInt` without try, `var`, possible null access (JS / Python), TODO, resource leaks (Python / Java / C), naming (Python / Java), complexity 21 / nesting 5 / 7 parameters, String += in loop, strlen in loop condition, assignment in condition, constant condition, `atoi`, duplicated block.
- Both secrets on one line are reported; no secret value, AWS key, GitHub token or `.env` content appears anywhere in stored findings; `.env`, binaries and `../` paths cannot be opened (403 / 415 / 404).
- Complexity measured on the syntax tree (`classify` = 21, nesting 5); empty files, syntax errors and unsupported languages produce no invented findings; test-file secrets are low confidence; placeholders are ignored; redaction covers keys, passwords and private-key blocks.
- Quality-score formula checked numerically (no findings → 100; 2 high + 1 medium over 2 KLOC → 63; dismissed findings excluded). Technical-debt items are sorted by priority and contain no time estimates.

**Dependencies** — npm + lockfile resolution and transitive entries, version conflicts, Maven properties, Gradle dynamic versions, CMake, PEP 621; invalid manifests, missing lockfiles (npm workspace and Pipfile); API never claims vulnerabilities.

**Findings management** — search, severity / category / path / confidence filters and sorting; dismissed status, notes and user-verified flag survive a re-analysis after lines shift by 2; a removed issue disappears (still visible with `includeResolved`); multiple repositories; analysis cancellation; removing a folder repository leaves the folder untouched; activity events.

**Git** — branch, commits with line counts, staged / unstaged / untracked detection, file and commit diffs, invalid commit id rejected, change review reports the newly added `eval` but not untouched findings, risk signals, and nothing is committed. Non-Git folder, empty repository and a missing Git executable are handled. **Malicious configuration:** a repository with an fsmonitor hook, a clean / smudge filter and a textconv driver that write a marker file — plain `git status` does write the marker (control), CodePilot's status, diff and log calls do not; disallowed sub-commands are refused. Diff parsing counts only added lines, not context lines.

**AI review (Ollama protocol stub)** — offline mode and unreachable Ollama fall back to labelled static analysis; missing model reported; valid review with secrets redacted in the prompt, an invented line number discarded, an AI issue on the SQL-injection line merged into a "Static + AI" finding, an AI-only finding stored with low confidence, cache hit without a new prompt, single-function review only sends that function, sensitive files refused; chunking stays within the budget without gaps or split functions; malformed JSON falls back; a running folder review is cancelled; a folder review job reviews the requested files; questions use ≤ 3 excerpts with citations; a follow-up on a finding includes its code; offline questions still return relevant locations.

**Optional tools** — Bandit and Ruff JSON parsed into labelled tool findings; capabilities list install commands and never runs ESLint / Semgrep.

**Reports** — Markdown contains metadata, breakdown, security disclaimer, debt, limitations and no secrets; HTML preview has a strict CSP; an un-analysed repository is refused; **PDF rendered by the local Edge** starts with `%PDF-` and is larger than 10 KB.

**Persistence** (`database.test.ts`) — a repository with a dismissed, annotated finding survives closing and reopening the database file, and the 2.0 data (projects, settings) is intact. A 1.0 database upgrades to schema v3 with records intact.

## End-to-end (Playwright, Microsoft Edge) — 46 tests

All earlier 2.0 journeys plus:
- page checks now include **Repository Analyzer** (no overflow, accessible names, no console errors);
- **R1** import a folder through the dialog → overview with real counts, languages, frameworks;
- **R2** file explorer → Monaco source, findings list and details; `.env` refused and its content never shown;
- **R3** security scanner → disclaimer, severity filter, search, dismiss a false positive, re-run analysis from the header, dismissal kept;
- **R4** ZIP import through the file picker: malicious archive rejected with the reason, valid archive imported;
- **R5** complexity, dependencies (offline notice, missing lockfile) and technical debt (no time estimates);
- **R6** Git: branch, file diff, change review flags the new `eval` and missing tests;
- **R7** AI review with local AI off → clearly labelled static fallback; question returns relevant code locations;
- **R8** reports: Markdown download, PDF download, preview renders;
- **R9** repositories persist across reload; removal via confirmation; original folder untouched;
- **M3** phone viewport: repository overview, findings, file viewer, dependencies and reports without horizontal scrolling.

## Bugs found and fixed during 3.0

1. AI requests were cancelled immediately: Node emits `close` on a fully-read request, so `req.on('close')` aborted every call. Cancellation now listens to the response's `close` before it finished.
2. A bare `password = '…'` was not detected (the pattern required a name prefix).
3. Detecting a different Git executable was undone by the next default call.
4. Q&A retrieval preferred `package.json` over the code for "Where is JSON parsed?" (path matches over-weighted; no stemming).
5. Git change review counted unchanged context lines as added lines.
6. With the real 1.5B model the file review fell back after two invalid answers: the 4 096-token context and 1 200-token answer cap truncated the JSON. Reviews now use an 8 192-token context and a 2 000-token cap and ask the model not to repeat static findings; the live test then passed.
7. Editor markers / line highlight were never shown for initially loaded content (pre-existing; effects ran before Monaco mounted).
8. A finding triaged out of the current filter stayed in the list.
9. Repository storage followed the configured database path instead of the database actually open (tests could have written into the real data folder; none had).

## Not covered / limits

- Ruff and Bandit were not installed, so their adapters are tested with recorded JSON, not by running the tools.
- AI review quality is model-dependent; tests assert the pipeline (valid JSON, labels, line validation, redaction, caching), not the correctness of the model's opinions.
- Repositories with thousands of files were not benchmarked; limits are 15 000 files and 1 MB per file, and the analysis yields to the event loop every 20 files.

---

# Previous report — CodePilot AI 2.0.0

**Date:** 2026-11-19
**Machine:** Windows 11 (16 GB RAM), Node.js 24.19.0, GCC/G++ 6.3.0 (MinGW.org), Java 26.0.1, Python 3.13.3, Microsoft Edge (installed), Ollama 0.40.16 with `qwen2.5-coder:1.5b`

## Summary

| Suite | Command | Result |
|---|---|---|
| Server (all suites except live AI) | `npx vitest run --exclude tests/ollama-live.test.ts` (in `server/`) | **183 / 183 passed** (224 s) before the final security patch; `api.test.ts` **40 / 40** re-run twice after it |
| Live local AI (real model) | `npx vitest run tests/ollama-live.test.ts` | **7 / 7 passed** with `qwen2.5-coder:1.5b` (230 s) |
| Client (React Testing Library) | `npm test -w client` | **14 / 14 passed** |
| End-to-end (Playwright, Edge) | `npm run e2e` | **35 / 35 passed**, 3 consecutive runs before the CSP change; after the CSP + diff-editor fix: J10 repeated 10× green, full suite green |
| Type checking | `tsc --noEmit` server + client | **0 errors** |
| Production build | `npm run build -w client` | **Success** |

Baseline before the upgrade: 134 server + 14 client tests, all passing; they were re-run after each phase.

## What the new tests cover

### Local AI — `tests/ai.test.ts` (stub) and `tests/ollama-live.test.ts` (real model)
- A local HTTP stub speaks the Ollama protocol and builds answers from the JSON schema it receives. Every AI feature (generation, conversion, explanation, algorithm, pseudocode, debugging, tests, viva, MCQ) is asserted to use engine `ollama` and to send a schema object as `format`.
- Failure modes: service not running, model missing, slow (timeout), malformed JSON (one repair retry, then fallback), garbage, oversized responses (cap) — each falls back to the offline engine with a notice.
- Live: connection test; a program for a problem outside the offline catalogue is generated **and then executed**; dictionary conversion; explanation; MCQs with four options.

### Analysis and converter — `tests/engine.test.ts`
- Tree-sitter complexity for the whole algorithm library matches textbook values with high confidence.
- Rich conversions (classes, maps, sets, exceptions, strings) of 6 fixtures are executed in every target language and compared with the original's output; C reports a warning for maps instead of producing wrong code.

### Windows sandbox — `tests/engine.test.ts`
Programs written to **evade the static guard** (the guard is asserted to report nothing) are still stopped by Windows:
- writing a file in the user profile via `fopen` with a computed mode → denied, file not created
- `system()` called through a function pointer → no child process output
- 900 MB allocation → refused by the Job Object
- reading a folder labelled no-read-up → `PermissionError`
- C, Python, JavaScript and Java programs run normally and report `isolation: job+lowil`

### Learning and dashboard — `tests/api.test.ts`, `tests/database.test.ts`
- Quiz answers are stored per question; the reported score must match the answers (400 otherwise); wrong answers enter the revision queue; a wrong retry keeps them, a correct one removes them.
- Learning paths compute progress from topic status; every topic has a category.
- Dashboard: engine breakdown sums to the number of history records; "continue" points at existing records; toolchain lists the detected runtimes and isolation level.
- A 1.0 database file with data is upgraded to schema v2 with every record intact.
- Security: foreign `Host` → 421; foreign `Origin` → 403; CSP and `X-Frame-Options` present.

### Algorithm library — `tests/library.test.ts`
- **26 algorithms × 5 languages = 130 programs** compile, run and match expected output (the 5 new algorithms: 25 programs, 20 generated by the translator).
- New tracers compute real results: shell / counting sort end sorted; jump search finds 13 at index 6 and reports −1 for a missing value; traversals give `1 2 4 5 3 6 7` / `4 2 5 1 6 3 7` / `4 5 2 6 7 3 1`; 3⁵ = 243.

### End-to-end — `e2e/` (Playwright, Microsoft Edge, throw-away database)
Every test fails on any console error, page error, failed request or HTTP 5xx.
- **Page checks (10):** every module loads with its heading, no horizontal overflow, every visible control has an accessible name.
- **Journeys (23, desktop):** sidebar navigation; Ctrl+K palette; offline generation labelled honestly + save to workspace; Python → Java conversion with semantic comparison; library visualiser stepping; code → pseudocode → flowchart SVG; explainer complexity + line-by-line; execution consent then sandboxed run with STDIN; debugger repair applied; guard blocks `subprocess`; test cases pass and fail correctly; scored MCQ quiz; project + file create / edit / reload / delete; history search and filters; light theme persists after reload; AI settings visible; demo data; backup; 404 page; revision mode; learning paths; dashboard command center; tree-traversal visualiser final output.
- **Phone (2, Pixel 7 viewport):** drawer navigation to every module with overflow and accessibility checks; code generation.

## Bugs found by the new tests and fixed

1. Every page overflowed horizontally by 36 px (hidden tooltips kept their layout box) — found by the E2E overflow check.
2. Custom widths on dropdowns were ignored, so toolbar dropdowns stretched full width.
3. "1 files" on project cards.
4. A stray `~~~^^^` line in Python tracebacks from the hidden guard wrapper.
5. Java could not run inside the one-process sandbox because Oracle's `javapath` launcher starts a second process; the real JVM path is now used.
6. Monaco threw "TextModel got disposed before DiffEditorWidget model got reset" when **Apply fix** closed the repair diff (intermittent; found by the console-error guard). Models are now detached before disposal; J10 passed 10× in a row afterwards.
7. The dashboard crashed when the API returned a payload without the new 2.0 fields (found by the client unit tests); the new cards are now optional.
8. DNS-rebinding gap: same-origin GET requests carry no `Origin` header, so the origin check alone could not stop them. A `Host` allowlist now rejects them.

## Notes and limits of this report

- One server run hit `ENOBUFS` (Windows socket buffer exhaustion) in a single API test; the same file passed on the next two runs. It is an OS resource condition, not an assertion failure.
- Playwright uses the installed Edge because the Chromium download from Playwright's CDN failed twice on this network.
- The live AI tests take ~4 minutes and are skipped automatically when Ollama or the model is absent.
- Light and dark themes were reviewed by screenshots of the Dashboard, Compiler, Learning Hub, Studio and Settings.
