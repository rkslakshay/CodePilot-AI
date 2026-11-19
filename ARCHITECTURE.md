# Architecture

## Overview

```
Browser (React SPA) ──/api──▶ Express API (127.0.0.1:4317) ──▶ SQLite (node:sqlite)
                                     │
                                     ├──▶ Offline engine (parser → IR → emitters / analyser / views)
                                     ├──▶ AI provider abstraction ──▶ Ollama (localhost only, optional)
                                     ├──▶ Tree-sitter (WebAssembly grammars) ──▶ structural analysis + complexity confidence
                                     ├──▶ Repository Analyzer (repo/) ──▶ read-only scan · rules · deps · git (read-only) · AI review · reports
                                     └──▶ Executor ──spawn──▶ runner-process.mjs ──▶ cpsandbox.exe (Job Object + Low IL) ──▶ program
```

- **Client**: React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router 7 (data router, lazy pages), Zustand, Monaco Editor (bundled locally, no CDN), Mermaid 12, lucide-react. Fonts are bundled through `@fontsource`, so the app makes no external requests at runtime.
- **Server**: Express 5, TypeScript (run by `tsx`), Zod validation, `node:sqlite`.
- The server listens on `127.0.0.1` only. Requests from non-local `Origin`s are rejected (403), requests whose `Host` header is not localhost are rejected (421, DNS-rebinding protection), and every response carries a strict Content-Security-Policy (`default-src 'self'`; no external scripts, fonts or connections).

### Why `node:sqlite` instead of Prisma or better-sqlite3

`node:sqlite` ships with Node ≥ 22.13. It needs no native compilation or binary downloads, which avoids Visual Studio Build Tools problems on Windows. Migrations are plain versioned SQL in `server/src/database/migrations.ts`, recorded in `schema_migrations`.

## Server layout

| Folder | Responsibility |
|---|---|
| `routes/` | REST endpoints (thin) |
| `validators/` | Zod schemas for every request body / query |
| `services/` | Business logic: `features.ts` (generator, converter, explainer, studio, execution, debugging, learning), `repo.ts` (persistence), `dashboard.ts`, `demo.ts`, `settings.ts`, `library.ts` |
| `providers/` | `AIProvider` interface, `OllamaProvider`, `resolveAI()` / `aiJson()` with fallback and engine labels |
| `engine/` | Offline language tooling (see below) |
| `content/` | Algorithm library, step tracers, generator templates, learning content |
| `repo/` | Repository Analyzer (3.0): ZIP reader, scanner, project detection, analysis rules, dependencies, Git, AI review, reports, background jobs; routes in `routes/repos.ts` |
| `execution/` | Runtime detection, static guard, executor, isolated runner process |
| `database/` | Connection, pragmas, migrations |
| `middleware/` | Error handling, rate limiting |

**Response format:** `{ ok: true, data }` on success, `{ ok: false, error: { code, message, details? } }` on failure. Errors are centralised in `middleware/errors.ts`.

**AI is separate from business logic:** feature services call `aiJson(prompt, system, contract(AI.<feature>))`. It returns parsed data from the configured provider, or `null` plus an engine notice explaining the fallback. Supporting another local provider means implementing `AIProvider` (`status`, `show`, `generate`).

### Local AI (2.0)

- **Detection** (`providers/ollama.ts`): install path (`where ollama`, `%LOCALAPPDATA%\Programs\Ollama`), version, service reachability, installed models (`/api/tags`, with quantisation) and per-model details (`/api/show`: parameters, context window, capabilities, estimated RAM vs. free RAM, advice).
- **Contracts** (`providers/schemas.ts`): one definition per feature produces both the JSON schema sent to Ollama as `format` (structured outputs) and the Zod validator for the reply. Features: generate, convert, explain, algorithm, pseudocode, debug, tests, viva, mcq.
- **Robustness:** streaming `/api/generate`, response cap 60 000 characters, `num_predict` from the "maximum answer length" setting, timeout from "response time limit", one repair retry when the JSON is malformed or fails validation. Errors are typed (`AIError`: not_running, timeout, model_missing, http, too_large, aborted, malformed) and converted to a user-facing notice; the request then uses the offline engine.
- CodePilot never downloads models; the Settings page shows the `ollama pull` command and approximate sizes.

## Engine labelling (honesty rule)

Every feature response includes `engine: { kind: 'ollama' | 'template' | 'offline', label, notice? }`:

- `ollama`: produced by the configured local model
- `template`: verified built-in content (algorithm library, generator templates, question bank)
- `offline`: deterministic rule-based processing (translator, analyser, debugger)

Template and offline output is never labelled as AI. When Local AI is selected but unavailable, `notice` explains why.

## Structural analysis (Tree-sitter, 2.0)

`engine/syntax.ts` parses C, C++, Java, Python and JavaScript with Tree-sitter grammars compiled to WebAssembly (`web-tree-sitter` + `tree-sitter-wasms`; no native build tools). It extracts functions / methods / constructors, classes, variables, loops, conditionals, calls and data structures, then estimates complexity:

- loops are classified by bound: constant (literal ranges, fixed tables), linear, logarithmic (halving / doubling), √n (`i * i <= n`) or unknown
- recursion shape: linear, divide-and-conquer, tree-walk (`.left` / `.right`), branching (exponential) — mutually exclusive branches are not double counted
- library costs (`sort` → n log n, `binary_search` → log n) except on hash maps / sets
- recognised patterns (bubble / merge / quick / heap sort, binary search, BFS, DFS, Dijkstra, Kadane, Fibonacci, Hanoi, …)

Each result carries a **confidence** (high / medium / low) and the reasons. When nothing can be determined the analyser says so rather than fabricating a bound. `analyzer.ts` merges this with the IR-based analysis (`analysisEngine` reports which one was used).

## Offline translation pipeline

```
source ─▶ lexer.ts ─▶ parser.ts ─▶ IR (ir.ts) ─▶ normalize.ts ─▶ infer.ts ─▶ emit.ts ─▶ target code
                                     │
                                     ├──▶ views.ts     → pseudocode + Mermaid flowchart
                                     └──▶ analyzer.ts  → complexity, issues, structure
```

**Lexer**
- Python: INDENT / DEDENT / NL tokens, f-strings
- C, C++, Java: preprocessor lines, comments, char literals
- JavaScript: template literals

**Parser**
- Recursive descent for statements, plus a Pratt parser for expressions.
- Recognises:
  - functions and classes / `main`
  - declarations, including arrays, `vector`, `ArrayList` and `new T[n]`
  - if / else-if, while, do-while, C-style for (lowered to a counting range when safe), for-each, switch (lowered to if-chains)
  - printing: `printf`, `cout`, `System.out`, `console.log`, `print` with `sep` / `end`
  - input: `scanf`, `cin`, `Scanner`, `input()`, including `map(int, input().split())`
  - **2.0:** classes / structs (fields, constructors incl. C++ initialiser lists, methods), dictionaries / maps, sets, `try` / `catch` / `finally`, `raise` / `throw` (mapped to ValueError, IndexError, KeyError, ZeroDivisionError, RuntimeError, Exception), string methods, slicing, `for k, v in d.items()`, Java `Map.Entry`, C++ structured bindings
- Unsupported constructs are kept verbatim as `raw` statements with a reason, then emitted as clearly marked comments plus a warning. The converter never invents code.

**Normalisation**
- Maps library calls to canonical intrinsics (`len`, `max`, `push`, `pow`, `tostr`, …).
- Lowers input expressions to `read` statements.
- Promotes script-level data used by functions to globals.

**Type inference**
- Iterative fixed-point over declarations, assignments, call sites and returns.
- Detects growable collections (push / pop) and widens running products to 64-bit.

**Emitters** (one per target) handle:
- declaration hoisting for dynamic → static targets
- integer vs true division semantics
- char arithmetic (`ord`, `charCodeAt`)
- printf format synthesis
- Java `ArrayList` get / set
- C array lengths (via `sizeof` or extra `_len` parameters)
- C++ `vector`
- camelCase naming for Java / JS
- a Scanner field or token readers for input

**Classes per target:** Python `class` with `__init__`; JavaScript `class`; Java `static class`; C++ `class` with pointer semantics (`new`, `->`); C `struct` plus `Cls_new()` and `Cls_method(self, …)` functions. Maps become `dict` / `Map` / `LinkedHashMap` (insertion order preserved) / `std::map`; C reports a warning instead of guessing.

**Verification:** the library's C, C++, Java and JavaScript code is generated from the hand-written Python. Each generated program is compiled and run in the test suite, and its output must match exactly.

## Algorithm Studio tracers

`content/tracers.ts` re-implements each library algorithm with a recorder. A snapshot is taken after every comparison, swap, visit or operation, capturing:
- array plus highlight sets
- graph state, distances and container
- stack / queue / linked list, BST layout, hash buckets, Hanoi rods
- call stack, variables and counters

The client visualiser only renders these snapshots. Nothing is animated decoratively.

## Data model (SQLite)

| Table | Purpose |
|---|---|
| `profiles` | Single local profile (id 1), editable name |
| `settings` | Key / value JSON per profile, validated by Zod on read and write |
| `projects` | Name (unique per profile), description, language, `is_demo` |
| `code_files` | `project_id` FK **ON DELETE CASCADE**, name (unique per project), language CHECK, content |
| `history` | Unified activity log: `kind` CHECK (generation, conversion, explanation, algorithm, execution, debug, learning), engine, status, input / output JSON, `is_demo` |
| `saved_algorithms` | Title, code, pseudocode, flowchart, steps, complexity |
| `learning_progress` | Per topic: status, quiz attempts, correct / total |
| `saved_questions` | Viva / MCQ / practice bookmarks (unique per question) |
| `practice_attempts` | Attempted / solved log |
| `repositories` *(v3)* | Imported repositories: source (folder / zip), root path, whether CodePilot owns the copy, status, profile, scan info, analysis summary, counters, `is_git` |
| `repo_files` *(v3)* | One row per scanned file: language, kind, size, lines, binary / sensitive / skipped flags, content hash, Tree-sitter metrics (functions with complexity and nesting) |
| `repo_findings` *(v3)* | Findings with severity / category / confidence / source CHECKs, fingerprint UNIQUE per repository, status, note, user-verified flag, `present` |
| `repo_dependencies` *(v3)* | Ecosystem, name, declared spec, resolved version, dev / direct flags, manifest |
| `repo_reviews` *(v3)* | Cached AI reviews (scope, target, content hash, model, engine, JSON result) and folder / repository review summaries |
| `repo_events` *(v3)* | Repository activity log (imports, analyses, triage) |
| `quiz_answers` *(v2)* | Every answered MCQ: question, options, chosen, correct, mode (quiz / revision). The revision queue is "questions whose most recent answer was wrong". |

All tables have timestamps, CHECK constraints and indexes on common query paths (profile + time, kind, language). Foreign keys are enforced (`PRAGMA foreign_keys = ON`). The database uses WAL mode.

**Design choice:** one `history` table replaces the separate Generations / Conversions / ExecutionHistory tables suggested in the brief. Search, filtering, sorting, restore and dashboard statistics then work uniformly with one query. The `kind` column plus indexes give the same separation.

**Migrations:** v1 (initial schema), v2 (`quiz_answers`) and v3 (Repository Analyzer tables, all `ON DELETE CASCADE` from `repositories`). Migrations only add structures; a 1.0 database is upgraded in place on start-up, and a test opens a v1 file with data and checks every record survives.

**Backups:** `VACUUM INTO` writes a consistent, compacted copy to `server/data/backups/` while the app runs. Backups can be listed, downloaded and deleted from Settings.

## Code execution

1. `executor.ts` checks:
   - the runtime is available
   - the static guard passes (`guard.ts`, per-language deny rules)
   - the concurrency limit (2) is not exceeded
2. A **separate Node process** (`runner-process.mjs`) is spawned with a minimal environment (`PATH` limited to toolchain folders + System32). The job travels over stdin as JSON.
3. The runner:
   - creates `os.tmpdir()/codepilot-run-*`
   - writes the source and compiles with a compile limit
   - runs with the user time limit and a 64 KB output cap
   - kills the process tree on timeout (`taskkill /T /F`)
   - deletes the folder
4. Language-specific measures:
   - Python: `-I -B -X utf8` and an audit hook (blocks writes, sockets, subprocess, ctypes, …)
   - Node: `--permission` (only the temp folder is readable; no writes, no child processes) and `--disallow-code-generation-from-strings`
   - Java: `-Xmx256m`
   - C on MinGW: compiled with `gcc -c` and linked with `g++`, because statically linked MinGW.org C executables crash (0xC0000409) when started by libuv with redirected stdio.

5. **Windows sandbox (2.0).** The run step is wrapped by `cpsandbox.exe run --mem <MB> --cpu <ms> --procs 1 -- <program>`:
   - built from `execution/sandbox/cpsandbox.cs` on first use with `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (part of Windows), stored with a SHA-256 stamp of the source and self-tested before use
   - **Job Object:** per-process and per-job memory limit (512 MB, 768 MB for Java), CPU-time limit, `ActiveProcessLimit = 1` (child processes cannot start), kill-on-job-close, UI restrictions (clipboard, desktop, system parameters)
   - **Low integrity token** (`CreateProcessAsUser` with a duplicated token labelled S-1-16-4096): writes to medium-integrity locations (your profile, documents, CodePilot data) are denied by Windows
   - **No-read-up label** (`S:(ML;OICI;NRNWNX;;;ME)`) on CodePilot's data and backup folders, so sandboxed programs cannot read the database
   - Java uses the real JVM binary (resolved from `java.home`) because Oracle's `javapath` launcher stub needs a second process
   - Tests prove enforcement by **bypassing the static guard** (function-pointer `system()`, computed `fopen` mode, 900 MB allocation, reading a protected folder)
   - If the sandbox cannot be built or the self-test fails, runs fall back to the guarded process and report `isolation: 'process'`.

**Limitations (stated in the UI too):**
- Network access is not blocked at the OS level (that needs administrator firewall rules); the static guard, the Python audit hook and Node's permission model block the common APIs.
- Low-integrity programs can still **read** ordinary files that your account can read, except CodePilot's protected folders.
- It is not a virtual machine; Windows Sandbox / containers were not used (Docker images would need downloads, which were declined).
- Execution therefore still requires explicit opt-in.

## Repository Analyzer (3.0)

```
import (folder path | ZIP upload)
   │  zip.ts: validate every entry first (no traversal / absolute / device names / symlinks / encryption,
   │          size + ratio limits), then extract into <data>/repos/<uuid>/   (folders are read in place)
   ▼
background job (jobs.ts: progress + cancel; the event loop yields every 20 files)
   │  scan.ts      read-only walk: lstat (links never followed), default ignores, nested .gitignore,
   │               binary detection, 1 MB file limit, sensitive files flagged and NOT read
   │  analyze.ts   per file: Tree-sitter metrics + syntax-tree rules, pattern rules (security / TODO),
   │               secret redaction; cross-file: duplicate blocks, unreferenced functions
   │  deps.ts      manifests + lockfiles (offline), manifest issues
   │  tools.ts     Ruff / Bandit when installed (Semgrep / ESLint detected, not run)
   │  detect.ts    languages, frameworks, project type, entry points, tests, docs, build config
   ▼
SQLite (one transaction): repo_files, repo_findings (upsert by fingerprint), repo_dependencies,
repositories.profile / analysis, repo_events
   ▼
summarize.ts  statistics, quality score, complexity report, technical debt   (computed on read)
review.ts     local AI review / questions / Git change review     report.ts  Markdown + PDF
```

**Nothing is executed.** The analyzer only reads files; no package scripts, build tools, linters with code configuration or project test runners are started.

### Findings

Every finding has path, line, column (when known), severity (critical / high / medium / low / info), category, rule ID, description, why it matters, suggested fix, confidence (high / medium / low), detection source (static / tool / ai / combined) and a redacted snippet. Line numbers always come from the parsed syntax tree or the matched line; findings without a location (for example a sensitive file or a missing lockfile) have `line = null`. The catalogue of all 47 rules is generated into [docs/ANALYSIS_RULES.md](docs/ANALYSIS_RULES.md).

**Stable identity:** a finding's fingerprint is `sha1(rule, path, redacted text of the reported line, occurrence index)`. Re-running the analysis upserts by fingerprint, so status (reviewed / dismissed / fixed), notes and "verified by me" survive edits that shift line numbers. Findings no longer detected are kept with `present = 0` (shown as "no longer detected").

### Quality score (reproducible)

```
weighted = Σ weight(severity) over present findings with status open or reviewed
           weights: critical 10, high 5, medium 2, low 0.5, info 0   (dismissed / fixed excluded)
density  = weighted / max(1, KLOC)          KLOC = (source + test lines) / 1000
score    = round(100 / (1 + density / 10))  grade A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, else E
```

The score summarises static findings; it is not a security guarantee. **Technical-debt priority** = impact weight (high 3, medium 2, low 1) × log2(1 + occurrences); each item lists its evidence. No effort or time estimates are produced.

### Complexity

Cyclomatic complexity = 1 + decision points (if / elif / loops / case / catch / ternary / `&&` / `||` / `??` / `and` / `or`) per function on the Tree-sitter tree; nested functions are measured separately. Nesting depth counts nested control blocks (else-if chains do not add depth).

### Local AI review

- Files are split into chunks of ≈6 000 characters, preferring function boundaries (`chunkFile`). A folder or whole-repository review is a background job that reviews at most 15 files (40 maximum) ranked by finding severity and complexity — never one prompt for the whole repository.
- Every prompt passes through `redactSecrets`; sensitive files are refused before anything is read.
- Prompts include line-numbered code, the repository profile and up to 8 static findings for the chunk ("do not repeat these"). Context window 8 192 tokens; answer cap 2 000 tokens.
- Answers must match the `REVIEW.file` JSON schema (Ollama structured outputs) and are validated with Zod, with the shared repair retry. Line numbers outside the chunk are discarded (stored as "no specific line").
- Results are cached in `repo_reviews` by scope, target, content hash and model.
- AI issues become findings with source `ai` and low confidence. An AI issue on the same line (±1) and a related category as a static finding marks that finding `combined` instead of duplicating it. The AI never modifies files.
- Questions use keyword retrieval (file paths, function names, term frequency, stemming) to pick at most three excerpts.
- Cancellation: the HTTP request's `close` aborts the Ollama call (`AbortSignal`); background jobs have a cancel endpoint.
- Offline / failure: the response is the file's static analysis labelled "Static analysis only (offline, not AI)" with the reason.

### Git (read-only)

Allowed sub-commands: `rev-parse`, `symbolic-ref`, `log`, `status`, `diff`, `show`, `rev-list`. An imported repository's own `.git/config` can make Git run programs, so every call:

- adds `-c` overrides: `core.fsmonitor=false`, `core.pager=cat`, `core.sshCommand=`, `diff.external=`, `credential.helper=`, `protocol.allow=never`, and empties every `filter.<name>.clean/smudge/process`, `diff.<name>.textconv/command` and `merge.<name>.driver` named in the config;
- uses `--no-ext-diff --no-textconv`, ignores system and global config (`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL`), runs without a shell, with a stripped environment, a timeout and an output cap;
- validates commit IDs (hex only) and paths (no `..`, no leading `-`).

A test configures a malicious fsmonitor, clean filter and textconv, proves plain `git status` executes it (control), and proves CodePilot's calls do not. ZIP imports never include `.git`.

**Change review** analyses changed files against HEAD, keeps findings on added lines only (the `+` lines of each hunk — context lines are ignored; untracked files count as all new), and adds risk signals: source changed without test changes, deleted tests, large changes, security- or configuration-sensitive paths, dependency manifest changes, high-severity findings on changed lines. With local AI it also explains purpose, impact, risks and suggested tests (diff truncated to the context budget; sensitive files excluded).

### Reports

`report.ts` builds Markdown with analysis date, repository identifier, tool versions, AI model, findings breakdown, security and quality findings, complexity, dependencies, technical debt, AI review summary, next steps, limitations and the rule appendix. A partial analysis is labelled as such. PDF: the Markdown is converted to print-styled HTML and rendered by the locally installed Microsoft Edge / Chrome in headless mode with an isolated profile, extensions and background networking disabled and a dead proxy (`--proxy-server=127.0.0.1:9`), so no network access is possible.

### Future GitHub integration (planned, not implemented)

The analysis pipeline only needs a folder, so GitHub support can be added without a cloud backend:

1. **Repository import** — `git clone --depth 1` of a public repository URL into `<data>/repos` (network use with explicit consent), then the existing pipeline; or the GitHub "Download ZIP" path that already works today.
2. **Authentication** — GitHub OAuth *device flow* (no client secret, no server-side callback, works for a local app) or a fine-grained personal access token stored in the OS credential store, never in SQLite or logs.
3. **Pull-request analysis** — REST `GET /repos/{owner}/{repo}/pulls/{n}/files` + `git fetch` of the PR head, then the existing change review on the PR diff.
4. **PR comments** — `POST /repos/{owner}/{repo}/pulls/{n}/reviews` only after the user previews and confirms each comment.
5. **Webhooks** — require a publicly reachable endpoint, which contradicts the local-only design; polling on demand is the free, local alternative.
6. **Commit analytics** — from local `git log` (already available) or the REST commits API.

Limits: unauthenticated REST calls are limited to 60 requests / hour (5 000 with a token); private repositories need a token; all of it requires an internet connection. None of this is implemented, and the UI does not pretend otherwise.

## Learning Hub (2.0)

- `content/learning-paths.ts`: five ordered learning paths and four topic categories; path progress is computed from `learning_progress`.
- Quizzes post every answer (`answers[]`); the server checks that the reported score matches the answers before recording.
- `GET /api/learning/revision` returns the revision queue; `POST /api/learning/revision` records a retry. A correct retry removes the question from the queue, a wrong one keeps it.

## End-to-end tests

`playwright.config.ts` starts `e2e/serve.mjs`, which wipes a throw-away database in the temp folder and runs the production build on port 4417, so your data is never touched. The browser is the installed Microsoft Edge (`channel: 'msedge'`). A shared fixture fails a test on any console error, page error, failed request or HTTP 5xx; page checks also assert no horizontal overflow and an accessible name for every visible control.

## Frontend

- Pages are lazy-loaded. Monaco is a separate chunk loaded on first editor use.
- `useHandoff` (Zustand) passes code between tools (e.g. Generator → Compiler, History → restore).
- Theme: CSS variables on `:root` (`.dark` / `.light`) plus `data-accent`, mapped to Tailwind tokens (`bg-card`, `text-muted`, …).
- No `alert()` / `prompt()`: dialogs, a promise-based confirm, and toasts.
- Accessibility: focus-visible rings, skip-to-content link, dialog focus trap, Escape to close, ARIA roles on tabs / switches / menus / progress bars / live step messages, keyboard command palette, `prefers-reduced-motion` support.
- `window.monaco` is exposed so end-to-end tests can set editor content.
