/** Shared finding types and the catalogue of CodePilot's own static-analysis rules. */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'high' | 'medium' | 'low';
export type Category = 'bug' | 'security' | 'complexity' | 'maintainability' | 'performance' | 'style' | 'dependency' | 'debt';
export type Source = 'static' | 'tool' | 'ai' | 'combined';

export interface Finding {
  path: string;
  line: number | null;
  col: number | null;
  endLine: number | null;
  severity: Severity;
  category: Category;
  ruleId: string;
  title: string;
  description: string;
  why: string;
  fix: string;
  confidence: Confidence;
  source: Source;
  tool: string;
  snippet: string;
  /** trimmed, redacted text of the reported line (used for stable fingerprints; not stored) */
  anchor?: string;
}

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, high: 5, medium: 2, low: 0.5, info: 0 };

export interface RuleDoc {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  confidence: Confidence;
  method: 'tree-sitter' | 'pattern' | 'cross-file' | 'manifest' | 'metric';
  languages: string;
  why: string;
  fix: string;
}

/** Documentation for every built-in rule (shown in the UI and in reports). */
export const RULES: RuleDoc[] = [
  // ---------------------------------------------------------------- bugs / correctness (Tree-sitter)
  { id: 'CP-BUG-001', title: 'Unreachable code', category: 'bug', severity: 'medium', confidence: 'high', method: 'tree-sitter', languages: 'JS, TS, Python, Java, C, C++', why: 'Statements after return / throw / break / continue never run; this usually means a logic error or leftover code.', fix: 'Remove the dead statements or move them before the jump.' },
  { id: 'CP-BUG-002', title: 'Empty catch / except block', category: 'bug', severity: 'medium', confidence: 'high', method: 'tree-sitter', languages: 'JS, TS, Python, Java, C++', why: 'Swallowing an exception hides failures and makes bugs very hard to diagnose.', fix: 'Handle the error, log it with context, or re-throw it. If ignoring is intentional, add a comment explaining why.' },
  { id: 'CP-BUG-003', title: 'Assignment inside a condition', category: 'bug', severity: 'medium', confidence: 'medium', method: 'tree-sitter', languages: 'JS, TS, Java, C, C++', why: '`if (x = y)` assigns instead of comparing — a classic typo for `==` / `===`.', fix: 'Use a comparison operator, or move the assignment to its own statement.' },
  { id: 'CP-BUG-004', title: 'Constant condition', category: 'bug', severity: 'low', confidence: 'high', method: 'tree-sitter', languages: 'JS, TS, Python, Java, C, C++', why: 'A condition that is always true or always false makes one branch dead code.', fix: 'Remove the condition or the unreachable branch.' },
  { id: 'CP-BUG-005', title: 'Comparison of a value with itself', category: 'bug', severity: 'medium', confidence: 'high', method: 'tree-sitter', languages: 'JS, TS, Python, Java, C, C++', why: '`x == x` is always true (except NaN) and is almost always a typo.', fix: 'Compare with the intended variable; use Number.isNaN / math.isnan for NaN checks.' },
  { id: 'CP-BUG-006', title: 'Possible null / undefined access', category: 'bug', severity: 'medium', confidence: 'medium', method: 'tree-sitter', languages: 'JS, TS, Python', why: 'Calls such as `find()`, `querySelector()`, `getElementById()`, `re.match()` and `dict.get()` can return nothing; using the result directly can crash.', fix: 'Check the result before using it (optional chaining `?.`, an `if` guard, or a default value).' },
  { id: 'CP-BUG-007', title: 'Loose equality', category: 'bug', severity: 'low', confidence: 'high', method: 'tree-sitter', languages: 'JS, TS', why: '`==` performs type coercion (`"0" == 0` is true), which causes surprising results.', fix: 'Use `===` / `!==` (comparing with `null` to match both null and undefined is the usual exception).' },
  { id: 'CP-BUG-008', title: 'Bare except', category: 'bug', severity: 'low', confidence: 'high', method: 'tree-sitter', languages: 'Python', why: '`except:` also catches KeyboardInterrupt and SystemExit and hides programming errors.', fix: 'Catch specific exceptions, or at least `except Exception:`.' },
  { id: 'CP-BUG-009', title: 'Unused local variable', category: 'maintainability', severity: 'low', confidence: 'medium', method: 'tree-sitter', languages: 'JS, TS, Python, Java, C, C++', why: 'A variable that is assigned but never read is noise and can indicate a forgotten use.', fix: 'Remove it, or use it where intended. Prefix with `_` if it must exist.' },
  { id: 'CP-BUG-010', title: 'Possibly unused function', category: 'maintainability', severity: 'info', confidence: 'low', method: 'cross-file', languages: 'JS, TS, Python, Java, C, C++', why: 'The function name does not appear anywhere else in the repository. It may be dead code (or called dynamically / from outside).', fix: 'Delete it if it is really unused, or document how it is invoked.' },
  { id: 'CP-BUG-011', title: 'Missing error handling', category: 'bug', severity: 'low', confidence: 'medium', method: 'tree-sitter', languages: 'JS, TS, Java', why: 'JSON.parse / Integer.parseInt throw on bad input, and promise chains without `.catch` produce unhandled rejections.', fix: 'Wrap the call in try / catch (or add `.catch`) and handle invalid input.' },
  { id: 'CP-BUG-012', title: 'Possible resource leak', category: 'bug', severity: 'medium', confidence: 'medium', method: 'tree-sitter', languages: 'Python, Java, C, C++', why: 'Files, streams and connections opened without a guaranteed close leak handles, especially when an exception occurs.', fix: 'Use `with` (Python), try-with-resources (Java) or make sure every path calls close / fclose.' },
  { id: 'CP-BUG-013', title: 'Risky type conversion', category: 'bug', severity: 'low', confidence: 'high', method: 'tree-sitter', languages: 'JS, TS, C, C++', why: '`parseInt` without a radix and `atoi` (no error reporting) silently produce wrong numbers for unexpected input.', fix: 'Pass a radix (`parseInt(s, 10)`) / use `Number()`; in C use `strtol` and check `endptr` and `errno`.' },
  // ---------------------------------------------------------------- complexity / maintainability (metrics)
  { id: 'CP-CPX-001', title: 'High cyclomatic complexity', category: 'complexity', severity: 'medium', confidence: 'high', method: 'metric', languages: 'JS, TS, Python, Java, C, C++', why: 'Many independent paths make a function hard to understand and to test completely (complexity > 15 medium, > 25 high).', fix: 'Extract helper functions, use early returns or table-driven logic.' },
  { id: 'CP-CPX-002', title: 'Deep nesting', category: 'complexity', severity: 'medium', confidence: 'high', method: 'metric', languages: 'JS, TS, Python, Java, C, C++', why: 'More than 4 nested blocks is hard to read and a common source of logic errors.', fix: 'Use guard clauses / early returns and extract inner blocks into functions.' },
  { id: 'CP-CPX-003', title: 'Long function', category: 'maintainability', severity: 'low', confidence: 'high', method: 'metric', languages: 'JS, TS, Python, Java, C, C++', why: 'Functions longer than 80 lines (medium above 150) usually do several things.', fix: 'Split it into smaller functions with descriptive names.' },
  { id: 'CP-CPX-004', title: 'Long file', category: 'maintainability', severity: 'low', confidence: 'high', method: 'metric', languages: 'all source files', why: 'Files longer than 800 lines tend to mix responsibilities.', fix: 'Split the file by responsibility.' },
  { id: 'CP-CPX-005', title: 'Too many parameters', category: 'maintainability', severity: 'low', confidence: 'high', method: 'metric', languages: 'JS, TS, Python, Java, C, C++', why: 'More than 6 parameters are easy to pass in the wrong order.', fix: 'Group related parameters into an object / struct.' },
  { id: 'CP-DUP-001', title: 'Duplicated code', category: 'maintainability', severity: 'low', confidence: 'high', method: 'cross-file', languages: 'all source files', why: 'Copy-pasted blocks (8+ identical non-trivial lines) must be fixed in several places.', fix: 'Extract the shared logic into a function or module.' },
  { id: 'CP-PERF-001', title: 'Expensive call in a loop condition', category: 'performance', severity: 'low', confidence: 'high', method: 'tree-sitter', languages: 'C, C++', why: '`strlen` in a loop condition is re-evaluated on every iteration, turning O(n) into O(n²).', fix: 'Compute the length once before the loop.' },
  { id: 'CP-PERF-002', title: 'String concatenation in a loop', category: 'performance', severity: 'low', confidence: 'medium', method: 'tree-sitter', languages: 'Java', why: '`String +=` inside a loop copies the whole string every time (O(n²)).', fix: 'Use a StringBuilder.' },
  { id: 'CP-PERF-003', title: 'Repeated computation', category: 'performance', severity: 'info', confidence: 'low', method: 'tree-sitter', languages: 'JS, TS, Python, Java, C, C++', why: 'The same call with the same arguments is evaluated 3 or more times in one function.', fix: 'Store the result in a local variable if the value cannot change in between.' },
  { id: 'CP-STY-001', title: 'Naming convention', category: 'style', severity: 'info', confidence: 'high', method: 'tree-sitter', languages: 'JS, TS, Python, Java', why: 'Inconsistent names (camelCase functions in Python, lower-case class names) make code harder to scan.', fix: 'Follow the language convention: PascalCase classes, snake_case Python functions, camelCase JS / Java methods.' },
  { id: 'CP-STY-002', title: '`var` declaration', category: 'style', severity: 'info', confidence: 'high', method: 'tree-sitter', languages: 'JS, TS', why: '`var` is function-scoped and hoisted, which causes subtle bugs in loops and closures.', fix: 'Use `const` or `let`.' },
  { id: 'CP-DEBT-001', title: 'TODO / FIXME marker', category: 'debt', severity: 'info', confidence: 'high', method: 'pattern', languages: 'all text files', why: 'Unfinished work recorded in comments.', fix: 'Resolve it or move it to an issue tracker.' },
  // ---------------------------------------------------------------- security (patterns, with context checks)
  { id: 'SEC-001', title: 'Hard-coded secret / credential', category: 'security', severity: 'high', confidence: 'medium', method: 'pattern', languages: 'all text files', why: 'Secrets in source code end up in every clone, backup and fork and are hard to rotate.', fix: 'Move the value to an environment variable or secret store and rotate the exposed credential.' },
  { id: 'SEC-002', title: 'Private key in repository', category: 'security', severity: 'critical', confidence: 'high', method: 'pattern', languages: 'all text files', why: 'A committed private key lets anyone impersonate the key owner.', fix: 'Remove it from the repository (and its history) and revoke / replace the key.' },
  { id: 'SEC-003', title: 'Sensitive file in repository', category: 'security', severity: 'high', confidence: 'medium', method: 'pattern', languages: 'file names', why: '.env files, key stores and credential files usually contain secrets. CodePilot never reads their content.', fix: 'Remove the file, add it to .gitignore and rotate any credentials it contained.' },
  { id: 'SEC-004', title: 'Possible SQL injection', category: 'security', severity: 'high', confidence: 'medium', method: 'pattern', languages: 'Python, JS, TS, Java, PHP', why: 'Building SQL with string concatenation / formatting lets attacker-controlled input change the query.', fix: 'Use parameterised queries / prepared statements.' },
  { id: 'SEC-005', title: 'Shell / command execution', category: 'security', severity: 'high', confidence: 'medium', method: 'pattern', languages: 'Python, JS, TS, Java, C, C++', why: 'Passing dynamic input to a shell allows command injection.', fix: 'Avoid the shell: pass an argument list (subprocess.run([...]), execFile, ProcessBuilder) and validate input.' },
  { id: 'SEC-006', title: 'Dynamic code evaluation', category: 'security', severity: 'high', confidence: 'high', method: 'pattern', languages: 'Python, JS, TS', why: 'eval / exec / new Function run arbitrary code if any part of the string is attacker-controlled.', fix: 'Use a parser (JSON.parse, ast.literal_eval) or a lookup table instead.' },
  { id: 'SEC-007', title: 'Insecure deserialization', category: 'security', severity: 'high', confidence: 'medium', method: 'pattern', languages: 'Python, Java, JS', why: 'pickle, yaml.load, ObjectInputStream and similar can execute code while deserialising untrusted data.', fix: 'Use safe formats (JSON) or safe loaders (yaml.safe_load).' },
  { id: 'SEC-008', title: 'Possible path traversal', category: 'security', severity: 'high', confidence: 'medium', method: 'pattern', languages: 'Python, JS, TS, Java', why: 'File paths built from request input can escape the intended folder (`../../etc/passwd`).', fix: 'Normalise the path and verify it stays inside an allowed base directory.' },
  { id: 'SEC-009', title: 'Weak cryptography', category: 'security', severity: 'medium', confidence: 'medium', method: 'pattern', languages: 'Python, JS, TS, Java', why: 'MD5, SHA-1, DES, RC4 and ECB mode are broken for security purposes (fine for non-security checksums).', fix: 'Use SHA-256+ (or bcrypt / argon2 for passwords) and AES-GCM.' },
  { id: 'SEC-010', title: 'Insecure randomness for a secret', category: 'security', severity: 'medium', confidence: 'medium', method: 'pattern', languages: 'Python, JS, TS, Java', why: 'Math.random / random / java.util.Random are predictable and must not generate tokens, passwords or keys.', fix: 'Use crypto.randomBytes / crypto.getRandomValues, secrets, or SecureRandom.' },
  { id: 'SEC-011', title: 'Possible cross-site scripting (XSS)', category: 'security', severity: 'medium', confidence: 'medium', method: 'pattern', languages: 'JS, TS, HTML, Vue, Python templates', why: 'Inserting raw HTML (innerHTML, dangerouslySetInnerHTML, v-html, |safe) can execute attacker-supplied scripts.', fix: 'Insert text (textContent) or sanitise the HTML with a vetted library.' },
  { id: 'SEC-012', title: 'Insecure HTTP URL', category: 'security', severity: 'low', confidence: 'medium', method: 'pattern', languages: 'all text files', why: 'Plain HTTP traffic can be read and modified in transit.', fix: 'Use https:// (localhost URLs are ignored by this rule).' },
  { id: 'SEC-013', title: 'TLS certificate verification disabled', category: 'security', severity: 'high', confidence: 'high', method: 'pattern', languages: 'Python, JS, TS, Go', why: 'Disabling certificate checks allows man-in-the-middle attacks.', fix: 'Keep verification on; trust a specific CA bundle if needed.' },
  { id: 'SEC-014', title: 'Unsafe configuration default', category: 'security', severity: 'medium', confidence: 'medium', method: 'pattern', languages: 'Python, JS, TS', why: 'Debug mode, wildcard CORS / ALLOWED_HOSTS and binding to all interfaces expose more than intended in production.', fix: 'Make these settings environment-specific and restrictive by default.' },
  { id: 'SEC-015', title: 'Unsafe C string / input function', category: 'security', severity: 'high', confidence: 'high', method: 'pattern', languages: 'C, C++', why: '`gets` cannot limit input length (buffer overflow); `strcpy` / `strcat` / `sprintf` overflow when the source is too long.', fix: 'Use fgets, strncpy / strlcpy, snprintf with the buffer size.' },
  { id: 'SEC-016', title: 'Unsafe file permissions / temporary files', category: 'security', severity: 'medium', confidence: 'medium', method: 'pattern', languages: 'Python, shell, JS', why: 'World-writable permissions (777) and tempfile.mktemp (race condition) let other users tamper with files.', fix: 'Use the least permissions needed and tempfile.mkstemp / NamedTemporaryFile.' },
  // ---------------------------------------------------------------- dependencies (manifests)
  { id: 'DEP-001', title: 'Missing lockfile', category: 'dependency', severity: 'medium', confidence: 'high', method: 'manifest', languages: 'npm, Pipenv', why: 'Without a lockfile, every install can resolve different versions.', fix: 'Commit package-lock.json / yarn.lock / pnpm-lock.yaml / Pipfile.lock.' },
  { id: 'DEP-002', title: 'Unpinned / broad version range', category: 'dependency', severity: 'low', confidence: 'high', method: 'manifest', languages: 'npm, PyPI, Gradle', why: 'Ranges such as `*`, `>=1.0` or no version at all allow unexpected major upgrades.', fix: 'Pin versions (or use caret / tilde ranges together with a lockfile).' },
  { id: 'DEP-003', title: 'Duplicate dependency declaration', category: 'dependency', severity: 'low', confidence: 'high', method: 'manifest', languages: 'npm, PyPI, Maven', why: 'Declaring the same package twice makes the effective version unclear.', fix: 'Keep a single declaration.' },
  { id: 'DEP-004', title: 'Multiple installed versions', category: 'dependency', severity: 'info', confidence: 'high', method: 'manifest', languages: 'npm lockfiles', why: 'Several versions of one package increase size and can behave differently.', fix: 'Align the ranges of the packages that depend on it (npm dedupe).' },
  { id: 'DEP-005', title: 'Possibly unused dependency', category: 'dependency', severity: 'info', confidence: 'low', method: 'manifest', languages: 'npm, PyPI', why: 'No import of the package was found; unused dependencies add install time and attack surface.', fix: 'Remove it if it is really unused (some packages are loaded by tools or dynamically).' },
  { id: 'DEP-006', title: 'Invalid manifest', category: 'dependency', severity: 'medium', confidence: 'high', method: 'manifest', languages: 'all manifests', why: 'The manifest could not be parsed, so tools may fail to install the project.', fix: 'Fix the syntax error.' },
];
export const RULE_BY_ID = new Map(RULES.map((r) => [r.id, r]));
