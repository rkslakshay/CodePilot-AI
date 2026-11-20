# Feature Tracker

Status legend:
- **Implemented**: code complete
- **Tested**: covered by automated tests (server / client unit tests)
- **E2E**: covered by a Playwright journey in a real browser (Microsoft Edge)
- **Verified**: tested and also inspected visually (screenshots)

| Area | Feature | Status |
|---|---|---|
| Shell | Sidebar with 11 modules, collapse / expand, mobile drawer | E2E (desktop + phone) |
| Shell | Top bar: page title, command search (Ctrl+K), theme toggle, workspace menu, AI status pill | E2E |
| Shell | Dark / light / system theme, 4 accent colours | E2E (light persists after reload), Verified (screenshots) |
| Shell | Toasts, confirm dialogs, empty / loading / error states, 404 page, route error boundary | Tested, E2E (404) |
| Shell | Skip-to-content link, reduced-motion support, accessible names on every control | E2E (accessibility check on all pages) |
| Dashboard | Statistics from database (generations, runs + success rate, projects / files, learning) | Tested, E2E |
| Dashboard | **2.0** Continue where you left off (last file, last work, topics in progress) | Tested, E2E |
| Dashboard | **2.0** Compiler & runtime availability with sandbox status | Tested, E2E |
| Dashboard | **2.0** How results were produced (local AI / offline / template) from history records | Tested, E2E |
| Dashboard | 14-day activity chart, language usage, recent projects / files / generations / conversions / activity, saved algorithms, AI card | Verified |
| Dashboard | Load / remove demo data | E2E |
| Generator | Prompt, language, difficulty, style, requirements | E2E |
| Generator | Offline: 23 templates (verified in 5 languages) + 26 library algorithms | Tested |
| Generator | Honest no-match response + labelled starter skeleton | Tested |
| Generator | Copy / download / save to workspace / run / explain | E2E (save to workspace) |
| Generator | Local AI generation with JSON schema + validation | Tested (stub + real qwen2.5-coder:1.5b) |
| Converter | 20 language pairs through IR pipeline | Tested (fixtures × 20 pairs executed) |
| Converter | **2.0** Classes, constructors, methods, dicts / maps, sets, exceptions, string methods, slicing | Tested (6 fixtures executed in all targets; C warns for maps) |
| Converter | Semantic comparison | E2E |
| Converter | Warnings for unsupported constructs, never claims equivalence without a run | Tested |
| Converter | Verify by running both programs | Implemented |
| Converter | Local AI conversion | Tested (stub + real model) |
| Studio | Library of **26** algorithms incl. **2.0** counting sort, shell sort, jump search, tree traversals, fast exponentiation | Tested (130 programs executed) |
| Studio | Steps, pseudocode, worked example, complexity table | Verified |
| Studio | Mermaid flowcharts with zoom / fit / reset / SVG / PNG export | E2E (SVG renders) |
| Studio | Dry-run visualiser with real tracers; **2.0** sample input + final output panel | Tested, E2E (tree traversal, bubble sort) |
| Studio | Problem → algorithm; code → steps / pseudocode / flowchart / other languages | Tested, E2E |
| Studio | AI pseudocode with offline flowchart / complexity (sections labelled) | Tested (stub + real model) |
| Studio | Saved algorithms | Implemented |
| Explainer | Summary, overview, line-by-line (beginner / advanced) | E2E |
| Explainer | **2.0** Tree-sitter structure: classes, methods, loops with bounds, recursion shape, data structures | Tested |
| Explainer | **2.0** Complexity with confidence (high / medium / low) and reasons; unknown when unsure | Tested (library table + fixtures) |
| Explainer | Error / inefficiency detection, syntax errors, editor markers | Tested |
| Compiler | Runtime detection with versions + install hints | E2E |
| Compiler | **2.0** Windows sandbox: Job Object (memory, CPU, one process, kill-on-close, UI limits) + low integrity + protected data folder | Tested (guard bypassed on purpose: writes, child processes, 900 MB alloc, protected read all blocked) |
| Compiler | Guarded execution: separate process, temp dir, timeout, output cap, stripped env, static guard, Python audit hook, Node permissions | Tested, E2E |
| Compiler | Isolation level reported per run and in the UI | Tested, E2E |
| Compiler | STDIN, output / error panels, status, timings, samples | E2E |
| Compiler | Execution opt-in with safety notice | Tested, E2E |
| Debugger | Error interpretation, common mistakes, rule-based repair + diff | Tested, E2E |
| Debugger | Test case generation, run all, expected vs actual | Tested, E2E |
| Debugger | AI-assisted repair and tests | Tested (stub + real model) |
| Learning | **2.0** Learning paths with progress and next topic | Tested, E2E |
| Learning | **2.0** Topic categories with filter | Tested |
| Learning | 11 DSA topics with lessons | E2E |
| Learning | Viva generator (bank / AI), levels | Tested |
| Learning | MCQ quiz with scoring; **2.0** per-question answers stored, score checked against answers | Tested, E2E |
| Learning | **2.0** Explanation for every wrong answer (your choice vs. correct answer) | E2E |
| Learning | **2.0** Revision mode: missed questions until answered correctly | Tested, E2E |
| Learning | Practice problems: hints, verified solutions, attempted / solved; **2.0** difficulty filter | Tested |
| Learning | Saved questions, statistics, practice history, completion tracking | Tested |
| Workspace | Projects: create / rename / delete (cascading) / search | Tested, E2E |
| Workspace | Files: create / edit / save / rename / duplicate / download / delete | Tested, E2E |
| History | Persistent log, search, filters, sort, details, restore, delete, confirmed clear | Tested, E2E |
| Settings | Theme, accent, editor preferences | E2E |
| Settings | **2.0** Ollama installation, service status, model details card, response time limit, max answer length, install guide | Tested, E2E |
| Settings | Execution toggle with confirmation, time limit; sandbox wording | Tested |
| Settings | Database info, backups, demo data, profile, reset | Tested, E2E (backup) |
| Database | Migrations v1 + **v2** (`quiz_answers`), upgrade of a 1.0 database keeps all records | Tested |
| Database | FKs, CHECKs, indexes, WAL, persistence across restart, backups | Tested |
| API | Zod validation, central errors, rate limiting, local-origin check, **2.0** Host allowlist (DNS rebinding), CSP | Tested |
| Local AI | **2.0** Install / service / model detection, structured outputs, retry, timeouts, size cap, fallbacks | Tested (21 stub tests + 7 live tests with qwen2.5-coder:1.5b) |
| E2E | **2.0** Playwright suite: 23 journeys + 10 page checks (desktop), 2 phone journeys; console / request / overflow / accessibility guards | E2E (3 consecutive green runs) |
| Repo Analyzer | **3.0** Import local folder (read in place) with path validation (no drive roots / system folders / CodePilot data) | Tested, E2E |
| Repo Analyzer | **3.0** Import ZIP: traversal / absolute / device names / symlinks / encryption / size / bomb protection, validate-then-extract | Tested, E2E |
| Repo Analyzer | **3.0** Read-only scan: no link following, default ignores, nested .gitignore, binaries, 1 MB limit, secret files never read | Tested |
| Repo Analyzer | **3.0** Project profile: languages, frameworks, project type, entry points, managers, tests, docs, build config | Tested, E2E |
| Repo Analyzer | **3.0** Dashboard: real metrics, quality score (documented formula), distributions, activity, quick actions | Tested, E2E, Verified (dark + light screenshots) |
| Repo Analyzer | **3.0** File explorer with Monaco, finding markers, per-file findings and functions | E2E |
| Repo Analyzer | **3.0** 47 static rules (bugs, maintainability, performance, style, security, debt) with exact lines, severity, confidence | Tested (each rule on a known sample, line numbers checked) |
| Repo Analyzer | **3.0** Secret redaction in snippets, AI prompts and reports | Tested |
| Repo Analyzer | **3.0** Ruff / Bandit adapters (run when installed); Semgrep / ESLint detection with install hints | Tested (parsers; tools not installed on this machine) |
| Repo Analyzer | **3.0** Local AI review: file, function, folder, repository; chunking, cache, cancellation, validation, combined findings | Tested (stub: offline, missing model, malformed, cancel, chunking, redaction, cache) + live real model |
| Repo Analyzer | **3.0** Repository Q&A and follow-up questions on findings (≤ 3 retrieved excerpts) | Tested (stub + live), E2E (offline fallback) |
| Repo Analyzer | **3.0** Complexity report: distribution, most complex functions / files, most findings, maintainability concerns | Tested, E2E |
| Repo Analyzer | **3.0** Dependencies: npm / PyPI / Maven / Gradle / CMake, lockfiles, issues; no vulnerability claims | Tested, E2E |
| Repo Analyzer | **3.0** Technical debt: prioritised items with evidence, no time estimates | Tested, E2E |
| Repo Analyzer | **3.0** Git (read-only): branch, commits, staged / unstaged / untracked, diffs; malicious-config neutralisation | Tested (incl. fsmonitor / filter / textconv attack), E2E |
| Repo Analyzer | **3.0** Git change review: findings on added lines, risk signals, optional AI explanation | Tested, E2E |
| Repo Analyzer | **3.0** Findings management: search, filters, sort, reviewed / fixed / dismissed, notes, user-verified; persists across re-analysis and restart | Tested, E2E |
| Repo Analyzer | **3.0** Reports: Markdown + PDF (local Edge headless), metadata, limitations, partial-analysis label | Tested (PDF bytes checked), E2E (downloads) |
| Repo Analyzer | **3.0** Multiple repositories, background jobs with progress and cancel, removal keeps original folders | Tested, E2E |
| UML Studio | **3.1** 8 diagram types with UML notation (class, use case, sequence, activity, state machine, component, deployment, object); example + blank for each | Tested (notation per type in SVG), E2E, Verified (screenshots, both themes) |
| UML Studio | **3.1** Structured model with Zod schemas, semantic validation and notation rules, live issue list | Tested, E2E |
| UML Studio | **3.1** Natural language → UML with local AI (validated contracts, repair round, warnings) | Tested (stub Ollama), live run with qwen2.5-coder:1.5b (8 / 8 types valid) |
| UML Studio | **3.1** Offline rule-based generator (structured notation + sentences), labelled not AI, refuses unusable text | Tested (all spec examples), E2E (all 8 types) |
| UML Studio | **3.1** Source → class / sequence / activity diagrams (Tree-sitter; Java, Python, TS, JS, C++, C) with evidence | Tested, E2E (pasted code, My Workspace file) |
| UML Studio | **3.1** Repository → class / modules / architecture / deployment diagrams; refusal without evidence | Tested, E2E (from Repository Analyzer) |
| UML Studio | **3.1** Canvas: pan, zoom, fit, reset, grid, select, drag (containers move contents), connect | E2E |
| UML Studio | **3.1** Inspector for every element / relationship kind, outline, fragments, message order | E2E |
| UML Studio | **3.1** Undo / redo, cascade delete, auto layout preserving manual positions, regenerate, unsaved-changes guard | Tested, E2E |
| UML Studio | **3.1** Save / open / rename / duplicate / delete / search / filter; repository link (SET NULL on repository removal); migration v4 | Tested, E2E |
| UML Studio | **3.1** Export SVG, PNG, PDF, PlantUML (all types), Mermaid (class / sequence / state) | Tested (PDF bytes, text output), E2E (downloads) |
| UML Studio | **3.1** Entry points: sidebar, Dashboard, My Workspace, Repository Analyzer | E2E |
| UML Studio | **3.1** Responsive layout (phone) and dark theme | E2E |
| Not done | GitHub connection / OAuth / pull-request comments / webhooks (architecture planned in ARCHITECTURE.md) | Not started |
| Not done | Dependency vulnerability lookup (needs an online database and consent) | Not started |
| Not done | Container or Windows Sandbox isolation (would need image / feature downloads; declined) | Not started |
| Not done | OS-level network blocking for programs (needs administrator firewall rules) | Not started |
