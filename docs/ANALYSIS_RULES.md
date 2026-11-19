# Repository Analyzer — static-analysis rules

Generated from `server/src/repo/rules.ts` (run `npx tsx scripts/rulesdoc.ts` in `server/` to regenerate). 47 rules.

Severity and confidence below are the defaults; some rules raise or lower them per finding (for example a hard-coded secret in a test file is reported with low confidence, and cyclomatic complexity above 25 is reported as high).

| Rule | Title | Category | Default severity | Confidence | Method | Languages |
|---|---|---|---|---|---|---|
| CP-BUG-001 | Unreachable code | bug | medium | high | tree-sitter | JS, TS, Python, Java, C, C++ |
| CP-BUG-002 | Empty catch / except block | bug | medium | high | tree-sitter | JS, TS, Python, Java, C++ |
| CP-BUG-003 | Assignment inside a condition | bug | medium | medium | tree-sitter | JS, TS, Java, C, C++ |
| CP-BUG-004 | Constant condition | bug | low | high | tree-sitter | JS, TS, Python, Java, C, C++ |
| CP-BUG-005 | Comparison of a value with itself | bug | medium | high | tree-sitter | JS, TS, Python, Java, C, C++ |
| CP-BUG-006 | Possible null / undefined access | bug | medium | medium | tree-sitter | JS, TS, Python |
| CP-BUG-007 | Loose equality | bug | low | high | tree-sitter | JS, TS |
| CP-BUG-008 | Bare except | bug | low | high | tree-sitter | Python |
| CP-BUG-009 | Unused local variable | maintainability | low | medium | tree-sitter | JS, TS, Python, Java, C, C++ |
| CP-BUG-010 | Possibly unused function | maintainability | info | low | cross-file | JS, TS, Python, Java, C, C++ |
| CP-BUG-011 | Missing error handling | bug | low | medium | tree-sitter | JS, TS, Java |
| CP-BUG-012 | Possible resource leak | bug | medium | medium | tree-sitter | Python, Java, C, C++ |
| CP-BUG-013 | Risky type conversion | bug | low | high | tree-sitter | JS, TS, C, C++ |
| CP-CPX-001 | High cyclomatic complexity | complexity | medium | high | metric | JS, TS, Python, Java, C, C++ |
| CP-CPX-002 | Deep nesting | complexity | medium | high | metric | JS, TS, Python, Java, C, C++ |
| CP-CPX-003 | Long function | maintainability | low | high | metric | JS, TS, Python, Java, C, C++ |
| CP-CPX-004 | Long file | maintainability | low | high | metric | all source files |
| CP-CPX-005 | Too many parameters | maintainability | low | high | metric | JS, TS, Python, Java, C, C++ |
| CP-DUP-001 | Duplicated code | maintainability | low | high | cross-file | all source files |
| CP-PERF-001 | Expensive call in a loop condition | performance | low | high | tree-sitter | C, C++ |
| CP-PERF-002 | String concatenation in a loop | performance | low | medium | tree-sitter | Java |
| CP-PERF-003 | Repeated computation | performance | info | low | tree-sitter | JS, TS, Python, Java, C, C++ |
| CP-STY-001 | Naming convention | style | info | high | tree-sitter | JS, TS, Python, Java |
| CP-STY-002 | `var` declaration | style | info | high | tree-sitter | JS, TS |
| CP-DEBT-001 | TODO / FIXME marker | debt | info | high | pattern | all text files |
| SEC-001 | Hard-coded secret / credential | security | high | medium | pattern | all text files |
| SEC-002 | Private key in repository | security | critical | high | pattern | all text files |
| SEC-003 | Sensitive file in repository | security | high | medium | pattern | file names |
| SEC-004 | Possible SQL injection | security | high | medium | pattern | Python, JS, TS, Java, PHP |
| SEC-005 | Shell / command execution | security | high | medium | pattern | Python, JS, TS, Java, C, C++ |
| SEC-006 | Dynamic code evaluation | security | high | high | pattern | Python, JS, TS |
| SEC-007 | Insecure deserialization | security | high | medium | pattern | Python, Java, JS |
| SEC-008 | Possible path traversal | security | high | medium | pattern | Python, JS, TS, Java |
| SEC-009 | Weak cryptography | security | medium | medium | pattern | Python, JS, TS, Java |
| SEC-010 | Insecure randomness for a secret | security | medium | medium | pattern | Python, JS, TS, Java |
| SEC-011 | Possible cross-site scripting (XSS) | security | medium | medium | pattern | JS, TS, HTML, Vue, Python templates |
| SEC-012 | Insecure HTTP URL | security | low | medium | pattern | all text files |
| SEC-013 | TLS certificate verification disabled | security | high | high | pattern | Python, JS, TS, Go |
| SEC-014 | Unsafe configuration default | security | medium | medium | pattern | Python, JS, TS |
| SEC-015 | Unsafe C string / input function | security | high | high | pattern | C, C++ |
| SEC-016 | Unsafe file permissions / temporary files | security | medium | medium | pattern | Python, shell, JS |
| DEP-001 | Missing lockfile | dependency | medium | high | manifest | npm, Pipenv |
| DEP-002 | Unpinned / broad version range | dependency | low | high | manifest | npm, PyPI, Gradle |
| DEP-003 | Duplicate dependency declaration | dependency | low | high | manifest | npm, PyPI, Maven |
| DEP-004 | Multiple installed versions | dependency | info | high | manifest | npm lockfiles |
| DEP-005 | Possibly unused dependency | dependency | info | low | manifest | npm, PyPI |
| DEP-006 | Invalid manifest | dependency | medium | high | manifest | all manifests |

## Methods

- **tree-sitter** — evaluated on the syntax tree produced by the Tree-sitter grammars (`web-tree-sitter`), so comments and strings do not trigger it and line / column numbers come from the parser.
- **pattern** — line-based regular expressions with context checks (comment lines skipped for code rules, placeholders such as `your_api_key` ignored, local URLs ignored). Faster but less precise; confidence reflects that.
- **cross-file** — needs the whole repository (duplicate blocks, functions never referenced anywhere).
- **metric** — thresholds on measured values (complexity, nesting, length, parameter count).
- **manifest** — parsing of dependency manifests and lockfiles; no network access.

## Optional external tools

| Tool | Run automatically? | Why |
|---|---|---|
| Ruff | yes, when installed | `--isolated` ignores project configuration; reads files only |
| Bandit | yes, when installed | reads Python files; never imports them |
| Semgrep CE | no (detected only) | its registry rule packs are downloaded from the internet |
| ESLint | no (detected only) | a project's ESLint config is JavaScript that would run code from the imported repository |

Findings from external tools are labelled with the tool name and source "External tool".
