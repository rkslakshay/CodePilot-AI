# Test Report — CodePilot AI 3.1.0 (release candidate)

**Date:** 2026-11-21 (3.1 section); earlier sections 2026-11-20
**Machine:** Windows 11 (16 GB RAM), Node.js 24.19.0, Git 2.55.0, GCC/G++ 6.3.0 (MinGW.org), Java 26.0.1, Python 3.13.3, Microsoft Edge (installed), Ollama with `qwen2.5-coder:1.5b`. Ruff, Bandit, Semgrep and ESLint are **not** installed.

## 3.1 — First GitHub Actions run: sandbox memory-limit test (2026-11-21)

The first CI run (Windows Server 2025, build 26100) failed `Windows sandbox › enforces the memory limit`: the C test program printed `GOT` although the sandbox limits programs to 512 MB.

**Root cause — the test, not the sandbox.** The program allocated 900 MB with `malloc` + `memset` but never read the memory. GitHub's runner compiles with GCC 15.2 (x86_64, MinGW-Builds); at the app's `-O1` it removed both calls as dead code and compiled `main()` to `puts("GOT")`, so nothing was allocated (the Job Object read-back showed a peak of 1 MB). Locally, GCC 6.3 (32-bit MinGW.org) removed only the `memset`, so the `malloc` still reached the limit and the test passed.

**The limit itself is enforced on both machines.** Diagnostics on the runner and locally (temporary launcher instrumentation, since removed) showed: `SetInformationJobObject` succeeds with `JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_JOB_MEMORY` and 512 MB limits read back by `QueryInformationJobObject`; the process is created suspended, is a member of the job before `ResumeThread`; a 900 MB allocation that is actually used is refused; growth in 16 MB steps touching every page stops at 496 MB (peak 497 MB); Python gets `MemoryError` at 900 MB while 300 MB is allowed. The launcher runs nested inside the runner's / terminal's own job, which does not affect the limits.

**Fix (tests only, no sandbox change):** every memory-limit program now reads back each touched page and prints a checksum, so no compiler can remove the allocation. The original assertion is kept and the test additionally requires `REFUSED`. New regression tests: a 300 MB program succeeds with the exact checksum (proves the test really allocates), step-wise growth is stopped between 256 and 512 MB, and Python is refused at 900 MB. A mutation check (memory limit removed) makes all three limit tests fail locally.

## 3.1 — Final quality audit (2026-11-21, release candidate)

### Git
`main` = `e6700ef` (unchanged). `feature/uml-studio` is based exactly on `e6700ef` (merge base) and holds the UML Studio commit `6447c40` plus the audit commit. Working tree clean before the audit; no databases, environment files, build output, test artefacts or models are tracked. The remote `origin` has no refs — nothing has been pushed.

### Clean installation
`git clone` of the branch into an empty folder → `npm ci --offline` (433 packages from the lockfile, 32 s, no network) → type checks, server tests, client tests, production build and the full E2E suite: **all green**. Production start (`npm start` in `server/` with `NODE_ENV=production`) served the built SPA, reported version **3.1.0** from `/api/health`, sent the CSP header, refused a foreign `Host` (421) and a foreign `Origin` (403).

### Regression after the audit fixes (working tree)

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| Server tests (`--exclude tests/ollama-live.test.ts`) — includes Repository Analyzer, database / migrations v1→v4, API, engine, execution, UML | **312 / 312 passed** |
| Client tests | **15 / 15 passed** |
| Production build | Success |
| Playwright E2E (`npm run e2e`) | **67 passed**, 2 skipped (on-demand screenshot generators) |
| Live AI suite (`tests/ollama-live.test.ts`, run alone) | **7 / 8** in the last run. The repository-review case failed because `qwen2.5-coder:1.5b` returned malformed JSON twice; the app showed labelled offline results as designed. Earlier the same day it passed alone (8 / 8) and once failed under CPU load. Classified as a flaky live test caused by model output variance; the AI review code is unchanged since 3.0. |
| Live UML generation (all 8 types, run alone) | 8 / 8 valid, labelled *Local AI · qwen2.5-coder:1.5b*; unresolved references reported as warnings (use case, deployment). |

### Feature smoke test
The E2E suite exercises real user journeys in every module: Dashboard (demo data, continue-where-you-left-off, compiler availability — J18, J23), AI Code Generator (offline generation, save to workspace — J4, M2), Code Converter (Python → Java with semantic comparison — J5), Algorithm Studio (visualiser, pseudocode / flowchart — J6, J7, J24), Code Explainer (J8), Compiler & Debugger (consent, sandboxed run with stdin, error explanation and repair, guard, test cases — J9–J12), Learning Hub (quiz, revision, paths — J13, J21, J22), My Workspace (J14), History (J15), Settings (theme, AI status, backup — J16, J17, J19), Repository Analyzer (R1–R9, M3), UML Studio (U1–U19, M-UML). In addition, every module page was captured in light and dark themes at desktop (1440 × 900) and phone (Pixel 7) sizes against an isolated server with demo data, a sample repository and a saved diagram: no console errors, no page errors, no horizontal overflow; screenshots reviewed.

### Security review
| Area | Finding |
|---|---|
| Repository import / ZIP / paths / links | Unchanged since 3.0 and covered by the existing tests (traversal, absolute / UNC / device names, symlink and encrypted entries, archive bombs, validate-then-extract, junctions not followed). UML generation reads repository files only through `readRepoFile` (scanned files only, sensitive files refused, path confined to the repository root). |
| Secrets and AI prompts | Descriptions are secret-redacted before prompting; source-code and repository generation never use AI. The Ollama URL is restricted to loopback in settings validation and in the provider, so text cannot be sent to another host. |
| Diagram validation | Zod schema with length limits, 400 elements / 800 relationships / 60 fragments, 1 MB request body. **Fixed:** coordinates were only required to be finite — a crafted 10¹² px position reached the PDF renderer (500). Now bounded to ±1 000 000 (400 `invalid_diagram`); regression test added. |
| SVG export / canvas | All text and attribute values pass through one escaping serializer. Hostile text (`<script>`, `foreignObject`, `onload`, `javascript:` links, CDATA / comment openers) in every free-text field of all 8 types produced only plain SVG shape / text elements when parsed by Edge's XML parser — no event-handler attributes, no links; payload visible only as text. A regression test tokenises the SVG and was mutation-checked (it fails when escaping is removed). |
| PDF export | Local Edge / Chrome, 60 s timeout, network blocked via a dead proxy, HTML built only from the escaped SVG; filenames sanitised. |
| PNG export | **Fixed (robustness):** failed for very wide diagrams (browser canvas limit 65 535 px per side); scale now reduced to fit; unit test added. |
| File downloads, API validation, SQLite | Downloads are generated client-side or with sanitised `Content-Disposition`; all UML routes validate with Zod; SQL uses prepared statements with bound parameters (search uses an escaped `LIKE`). |
| Git, compiler execution, local file access, CSP / host allowlist | Unchanged since 3.0 and covered by the existing tests (Git config neutralisation, sandbox enforcement, guarded data folder, DNS-rebinding protection, CSP). Sandbox limitation unchanged and documented: programs can read files the user can read and network access is not blocked. |

## 3.1 — UML Studio regression (2026-11-21, branch `feature/uml-studio`)

| Check | Command | Result |
|---|---|---|
| Type checking | `npm run typecheck` | **0 errors** (server + client, including `shared/uml`) |
| Server, all suites except live AI | `npx vitest run --exclude tests/ollama-live.test.ts` in `server/` | **310 / 310 passed** (272 before 3.1 + 38 UML) |
| Client | `npx vitest run` in `client/` | **14 / 14 passed** |
| Production build | `npm run build -w client` | **Success** |
| End-to-end (Playwright, Edge) | `npm run e2e` | **67 passed**, 2 skipped (the on-demand documentation-screenshot generators) |
| Live local AI, existing suite | `npx vitest run tests/ollama-live.test.ts` | **8 / 8 passed** when run on its own. In one full parallel run the repository-review case failed with "AI unavailable" after 192 s under CPU contention; rerunning it alone passed (no code involved changed). |

### UML server tests (`server/tests/uml.test.ts`, 38 tests)
- **Model and validation:** all 8 examples valid, overlap-free and inside the canvas; lossless JSON round trip; structural errors with clear messages; duplicate ids, missing ends, wrong kinds, invalid ends, inheritance cycles and invalid containment detected; notation warnings (decision guards, missing initial node); `pruneInvalid` reports every removal.
- **Editing:** add / update / delete with cascade (children and relationships); kind changes validated; manual positions kept by automatic placement and cleared only by a forced layout; message reordering; undo / redo semantics.
- **Rendering and text:** notation present per type (stereotypes, italics, underline, diamonds, triangles, dashed lines, activations, fragments, fork bars, entry actions, sockets, execution environments, object headers); user text escaped; PlantUML for all 8 types; Mermaid only for class / sequence / state.
- **Offline natural language:** the specification examples for every type, structured notation, inferred items marked, unusable text refused.
- **Source code:** Java, Python (incl. quoted forward references), TypeScript generics, JavaScript, C++ pure virtual classes, C structs; sequence and activity extraction; refusal without classes / calls.
- **API:** CRUD, rename, duplicate, delete, type-change refusal, validation, templates, offline generation and 422 refusal, inline source and function listing, repository class / module / architecture / deployment generation, refusal without evidence, repository link cleared (`ON DELETE SET NULL`) when a repository is removed, docker-compose parsing, PDF bytes.
- **AI (stub Ollama):** valid answer labelled Local AI with prompt secrets redacted; one bounded semantic-repair round fixes undefined references; unresolved references reported; malformed output and an unreachable server fall back to the offline generator with a notice.
- `tests/database.test.ts` now also checks that migration v4 creates `uml_diagrams`; the existing v1 → latest upgrade test applies v4 to an old database with data.

### UML end-to-end journeys (`e2e/uml.spec.ts`, 19) and checks
U1 navigation (sidebar, Dashboard) and accessible names · U2 all 8 examples render and validate · U3 manual class diagram with members, inheritance, save and reload · U4 drag with undo / redo · U5 cascade delete with undo · U6 invalid «include» flagged · U7 offline generation labelled not AI + regenerate · U8 offline generation of the other 7 types · U9 pasted code → class / sequence / activity · U10 Repository Analyzer → UML, save, repository filter, low-confidence deployment warning · U11 deployment refused without evidence · U12 My Workspace file → UML · U13 SVG / PNG / PDF / PlantUML / Mermaid downloads verified by content, Mermaid not offered for deployment · U14 rename / duplicate / delete / filter · U15 zoom / fit / reset / grid · U16 sequence message order, message kind, fragment add + undo · U17 state entry action and object slots · U18 dark palette · U19 unsaved-changes guard. UML Studio was added to the page checks (overflow, accessible names) and the phone checks, including the editor on a Pixel 7 viewport.

### Live UML generation with `qwen2.5-coder:1.5b`

| Type | Time | Result |
|---|---|---|
| Class | 46.7 s | valid; 5 classes, 4 relationships |
| Use case | 19.2 s | valid after the repair round; 1 unresolved «include» target dropped and reported |
| Sequence | 14.8 s | valid; 4 participants, 5 messages |
| Activity | 16.7 s | valid; 8 nodes (the model named one decision "If Valid") |
| State machine | 18.2 s | valid; 7 states / pseudostates |
| Component | 12.3 s | valid; 5 components, 5 relationships |
| Deployment | 19.0 s | valid after the repair round; nesting lost — 3 unresolved parents reported as warnings |
| Object | 12.0 s | valid; 2 objects, 1 link |

All results were labelled **Local AI · qwen2.5-coder:1.5b**. The small model's omissions are reported, not filled in.

### Visual review
Every example type was screenshotted in the editor in light and dark themes (headless Edge) and reviewed. Fixed during review: drafts lost under React StrictMode, toolbar wrapping at 1440 px, inspector visibility selects too narrow, unlabelled AI switch, ligature arrows in the notation hint, and buttons inside `<label>` rows that took the wrong accessible name.

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
