# Changelog

## Unreleased — repository publication

- MIT `LICENSE`, GitHub Actions CI (type check, server + client tests, build, Playwright E2E on a free Windows runner; no AI model downloaded), issue templates, `.gitattributes`, hardened `.gitignore` (local database, secrets, model files, test output, local tool config).
- README rewritten for publication with screenshots of every major module.
- Test fixtures assemble fake private-key markers at runtime so the repository contains no secret-shaped literals.

## 3.0.0 — 2026-11-20

Repository intelligence. Everything from 2.0 is preserved; existing databases upgrade automatically (migration v3 only adds tables).

### Added — Repository Analyzer (new module)
- **Import** a local folder (read in place, never modified) or a ZIP archive (unpacked into CodePilot's storage). Safe ZIP reader on `node:zlib` with no new dependency: rejects path traversal, absolute / drive / UNC paths, Windows device names, symlink and encrypted entries, oversized archives and archive bombs, and validates the whole archive before writing anything.
- **Read-only scanner:** links and junctions are never followed; `.git`, `node_modules`, `dist`, `build`, virtualenvs and caches skipped; nested `.gitignore` honoured; binaries and files over 1 MB skipped; `.env`, keys and credential files listed but never read.
- **Project detection:** languages, frameworks (React, Next.js, Vue, Angular, Express, NestJS, Django, Flask, FastAPI, Spring Boot, …), project type, entry points, package managers, test folders, docs, build configuration.
- **Static analysis — 47 rules** on the existing Tree-sitter engine (now also loading the TypeScript / TSX grammars) plus security patterns: unreachable code, empty catch / bare except, assignment in condition, constant and self-comparing conditions, possible null access, loose equality, unused locals and functions, missing error handling, resource leaks, risky conversions, cyclomatic complexity, nesting, long functions / files, parameters, duplicated blocks, expensive loop conditions, string concatenation in loops, repeated computation, naming, TODO markers; secrets and private keys (redacted), sensitive files, SQL / command injection, eval, insecure deserialisation, path traversal, weak crypto, insecure randomness, XSS, plain HTTP, disabled TLS verification, unsafe defaults, unsafe C string functions, unsafe permissions. Every finding has location, severity, category, rule ID, why it matters, fix, confidence and source.
- **Optional tools:** Ruff and Bandit run when installed; Semgrep and ESLint are detected with install instructions but not run (registry downloads / executing project configuration).
- **Repository dashboard** with a documented, reproducible quality score, severity / category / language / file-type / complexity distributions, project profile, activity log and quick actions.
- **Local AI code review** (Ollama, `qwen2.5-coder:1.5b` tested): file, function, folder or whole-repository review in context-sized chunks; secrets redacted; JSON-schema answers validated with Zod; cached by content hash; cancellable; AI findings labelled and merged with agreeing static findings ("Static + AI"); repository Q&A and follow-up questions on findings from retrieved excerpts; static fallback when AI is unavailable. AI never edits files.
- **Complexity, dependency and technical-debt analysis:** most complex functions / files, files with most findings, maintainability concerns; npm, PyPI, Maven, Gradle and CMake manifests with lockfile resolution, missing lockfiles, unpinned ranges, duplicates, multiple installed versions and possibly unused packages (no vulnerability claims, fully offline); prioritised debt items with evidence and no invented time estimates.
- **Git (read-only):** branch, recent commits with line counts, staged / unstaged / untracked changes, file and commit diffs, and change review (findings on added lines, risk signals, optional AI explanation). Repository-configured fsmonitor, filters, textconv, external diff, pager and hooks are neutralised on every call.
- **Findings management:** search, filters (severity, category, status, source, confidence, file), sorting, reviewed / fixed / false positive, notes, "verified by me"; statuses survive re-analysis through line-independent fingerprints.
- **Reports:** Markdown and PDF (rendered by the locally installed Edge / Chrome, offline) with metadata, tool versions, AI model, findings breakdown, limitations and rule appendix; partial analyses are labelled.
- Background jobs with progress and cancellation; multiple repositories; removal deletes only CodePilot's own copy.
- `docs/ANALYSIS_RULES.md` generated from the rule catalogue.

### Fixed
- Code editor markers and line highlights passed together with the initial content were never shown (effects ran before the lazily-loaded Monaco editor mounted).
- 413 error message always said "limit 1 MB".

### Tests
- `server/tests/repo.test.ts` (86 tests), persistence-across-restart test, live real-model repository review, 9 new Playwright journeys (+ phone check).

## 2.0.0 — 2026-11-19

Upgrade of 1.0.0. Nothing was rebuilt from scratch; existing features, data and APIs are preserved. Existing databases upgrade automatically (migration v2 only adds a table).

### Added
- **Real local AI (Ollama)**
  - install detection (PATH and `%LOCALAPPDATA%\Programs\Ollama`), service status, installed models with quantisation
  - per-model details: parameters, context window, capabilities, estimated memory vs. free RAM, advice
  - structured outputs: every AI feature sends a JSON schema (`format`) and validates the reply with Zod; one automatic repair retry for malformed JSON
  - streaming generation with a response cap (60 000 characters), configurable time limit and maximum answer length
  - error codes for not installed / not running / model missing / timeout / malformed / too large; every failure falls back to the offline engine with a notice
  - AI used for generation, conversion, explanation, algorithm design, pseudocode, debugging, tests, viva and MCQs
  - live test suite against a real model (`tests/ollama-live.test.ts`, skipped when Ollama is absent)
- **Offline analysis with Tree-sitter** (`web-tree-sitter` + prebuilt grammars, WebAssembly, no native build): functions, methods, classes, loops with bound classification, recursion shape, data structures, recognised algorithm patterns, and complexity with a **confidence level** (high / medium / low) and reasons. Unknown cases are reported as unknown instead of guessed.
- **Converter**: classes (fields, constructors, methods), dictionaries / maps, sets, exceptions (`try` / `catch` / `finally`, `raise` / `throw`), string methods, slicing and nested-function hoisting; C output warns where it cannot be faithful.
- **Windows execution sandbox** (`execution/sandbox/cpsandbox.cs`), compiled on first use with the C# compiler that ships with Windows:
  - Job Object: memory limit, CPU-time limit, one active process (no child processes), kill-on-close, UI restrictions
  - Low integrity level: programs cannot write to your files or settings
  - CodePilot's data and backup folders are labelled no-read-up, so programs cannot read the database
  - every run reports its isolation level; the UI states the remaining limitations
- **Playwright end-to-end suite** (`e2e/`): 35 tests — 23 user journeys and 10 page checks on desktop, 2 journeys on a phone viewport. Every test fails on console errors, page errors, failed requests, 5xx responses; page checks also assert no horizontal overflow and accessible names for every control. Uses the Microsoft Edge already installed on Windows (no browser download).
- **Dashboard command center**: continue where you left off (last file, last work, in-progress topics), compiler and runtime availability with isolation level, and a breakdown of how results were produced (local AI / offline engine / templates).
- **Algorithm Studio**: Counting Sort, Shell Sort, Jump Search, Binary Tree Traversals (pre / in / post-order) and Fast Exponentiation, each in 5 verified languages with a real tracer; sample input and final output panel in the visualiser.
- **Learning Hub**: learning paths with progress, topic categories, per-question answer storage, a **Revision** mode for questions you got wrong, "why" explanations for every wrong answer, practice difficulty filter.
- Security: Host-header allowlist (DNS-rebinding protection) and a strict Content-Security-Policy.
- Accessibility and polish: skip-to-content link, reduced-motion support, labelled revision cards, progress bars with ARIA values.

### Fixed
- All pages overflowed horizontally by 36 px on desktop because hidden tooltips kept their layout box (found by the new E2E overflow check).
- Custom widths on dropdowns and inputs were ignored, so toolbar dropdowns stretched to full width (Compiler header).
- "1 files" pluralisation on project cards.
- Python tracebacks showed a stray `~~~^^^` marker line from the hidden guard wrapper.
- Monaco error "TextModel got disposed before DiffEditorWidget model got reset" when applying a debugger fix (intermittent).
- Dashboard crashed on API payloads without the 2.0 fields.
- Oracle's `javapath\java.exe` launcher stub starts a second process; the real JVM path is now resolved so Java runs inside the one-process sandbox.

## 1.0.0 — 2026-11-14

First complete release.

### Added
- Monorepo with npm workspaces: `server` (Express 5 + TypeScript + node:sqlite) and `client` (React 19 + Vite 7 + Tailwind 4).
- SQLite schema v1 with migrations, foreign keys, CHECK constraints, indexes, WAL mode and `VACUUM INTO` backups.
- Offline language engine:
  - lexer, parser, IR, normaliser and type inference
  - emitters for C, C++, Java, Python and JavaScript
  - pseudocode and Mermaid flowchart views
  - static analyser (line explanations, complexity, issue detection)
  - debugger (error interpretation, rule-based repair)
- AI provider abstraction with an optional Ollama provider (localhost only), model detection, a connection test and automatic offline fallback with explanatory notices.
- Guarded code execution through a separate runner process:
  - temp directories, time and output limits, stripped environment
  - static guard, Python audit hook, Node permission model
  - opt-in only
- Content:
  - 21-algorithm library with step tracers
  - 23 generator templates
  - 11 Learning Hub topics with viva questions, MCQs and practice problems
- Ten modules: Dashboard, AI Code Generator, Code Converter, Algorithm Studio, Code Explainer, Compiler & Debugger, Learning Hub, My Workspace, History and Settings.
- Command palette (Ctrl+K), dark / light themes, accent colours, responsive layout.
- Demo data loader with `is_demo` flags and one-click removal.
- Test suites: server (Vitest + Supertest, real-compiler integration) and client (Vitest + React Testing Library).

### Fixed during development
- MinGW.org C executables crashed (0xC0000409) when launched with redirected stdio. C programs are now compiled with `gcc -c` and linked through `g++`.
- Converter: parenthesisation of floor / truncating division, string-concatenation flattening in print statements, `length()` calls, `setprecision`, `toFixed`, growable-array detection, and dynamic list parameters in Java.
- UI:
  - quiz answers lost on rapid clicks (functional state update)
  - grid cards overflowing on narrow screens (`min-w-0`)
  - top-bar crash when the profile has no name
