import { writeFileSync } from 'node:fs';
import { RULES } from '../src/repo/rules.js';
const esc = (s: string) => s.replace(/\|/g, '\|');
const rows = RULES.map((r) => `| ${r.id} | ${esc(r.title)} | ${r.category} | ${r.severity} | ${r.confidence} | ${r.method} | ${esc(r.languages)} |`);
writeFileSync('../docs/ANALYSIS_RULES.md', `# Repository Analyzer — static-analysis rules

Generated from \`server/src/repo/rules.ts\` (run \`npx tsx scripts/rulesdoc.ts\` in \`server/\` to regenerate). ${RULES.length} rules.

Severity and confidence below are the defaults; some rules raise or lower them per finding (for example a hard-coded secret in a test file is reported with low confidence, and cyclomatic complexity above 25 is reported as high).

| Rule | Title | Category | Default severity | Confidence | Method | Languages |
|---|---|---|---|---|---|---|
${rows.join('\n')}

## Methods

- **tree-sitter** — evaluated on the syntax tree produced by the Tree-sitter grammars (\`web-tree-sitter\`), so comments and strings do not trigger it and line / column numbers come from the parser.
- **pattern** — line-based regular expressions with context checks (comment lines skipped for code rules, placeholders such as \`your_api_key\` ignored, local URLs ignored). Faster but less precise; confidence reflects that.
- **cross-file** — needs the whole repository (duplicate blocks, functions never referenced anywhere).
- **metric** — thresholds on measured values (complexity, nesting, length, parameter count).
- **manifest** — parsing of dependency manifests and lockfiles; no network access.

## Optional external tools

| Tool | Run automatically? | Why |
|---|---|---|
| Ruff | yes, when installed | \`--isolated\` ignores project configuration; reads files only |
| Bandit | yes, when installed | reads Python files; never imports them |
| Semgrep CE | no (detected only) | its registry rule packs are downloaded from the internet |
| ESLint | no (detected only) | a project's ESLint config is JavaScript that would run code from the imported repository |

Findings from external tools are labelled with the tool name and source "External tool".
`);
console.log('rules', RULES.length);
