/**
 * Offline debugging helpers: interprets compiler / runtime errors in plain English and
 * proposes rule-based repairs (shown to the user as a before/after diff).
 */
import type { Lang } from './ir.js';

export interface Diagnosis {
  line: number | null;
  severity: 'error' | 'warning';
  title: string;
  explanation: string;
  suggestion: string;
  raw: string;
}

interface Rule {
  re: RegExp;
  title: string;
  explain: (m: RegExpMatchArray) => string;
  fix: (m: RegExpMatchArray) => string;
}

const GCC: Rule[] = [
  { re: /expected (?:['‘],['’] or )?['‘];['’] before|expected ['‘];['’]/, title: 'Missing semicolon', explain: () => 'The compiler reached the next token while it still expected a statement to end. Usually the previous line is missing a ";".', fix: () => 'Add ";" at the end of the statement on the reported line or the line just above it.' },
  { re: /['‘](\w+)['’] undeclared|['‘](\w+)['’] was not declared in this scope/, title: 'Undeclared identifier', explain: (m) => `The name "${m[1] ?? m[2]}" is used but was never declared (or it is out of scope, or misspelled).`, fix: (m) => `Declare ${m[1] ?? m[2]} before using it, check the spelling, or include the header that defines it${['cout', 'cin', 'endl', 'vector', 'string'].includes(m[1] ?? m[2]) ? ' (#include <iostream> / using namespace std;)' : ''}.` },
  { re: /implicit declaration of function ['‘](\w+)['’]/, title: 'Function used without declaration', explain: (m) => `"${m[1]}" is called before it is declared. ${headerFor(m[1]) ? `It is defined in <${headerFor(m[1])}>.` : 'It might be misspelled or defined later in the file.'}`, fix: (m) => (headerFor(m[1]) ? `Add #include <${headerFor(m[1])}> at the top of the file.` : `Declare a prototype for ${m[1]}() above main(), or move the function definition above its first use.`) },
  { re: /expected declaration or statement at end of input|expected ['‘]}['’] at end of input/, title: 'Missing closing brace', explain: () => 'The file ended while a block was still open.', fix: () => 'Add the missing "}" — check that every "{" has a matching "}".' },
  { re: /redefinition of ['‘](\w+)['’]|conflicting declaration ['‘][^'’]*\b(\w+)['’]/, title: 'Duplicate definition', explain: (m) => `"${m[1] ?? m[2]}" is declared twice in the same scope.`, fix: () => 'Remove the second declaration or give one of them a different name.' },
  { re: /format ['‘](%\w+)['’] expects argument of type ['‘]([^'’]+)['’], but argument \d+ has type ['‘]([^'’]+)['’]/, title: 'Wrong format specifier', explain: (m) => `${m[1]} expects a ${m[2]} but a ${m[3]} was supplied.`, fix: () => 'Use %d for int, %ld/%lld for long, %f for float/double (printf), %lf for double (scanf), %c for char, %s for strings.' },
  { re: /too few arguments to function ['‘]([^'’(]+)/, title: 'Too few arguments', explain: (m) => `${m[1]} is called with fewer arguments than its definition requires.`, fix: () => 'Pass all required arguments in the call.' },
  { re: /too many arguments to function ['‘]([^'’(]+)/, title: 'Too many arguments', explain: (m) => `${m[1]} is called with more arguments than it accepts.`, fix: () => 'Remove the extra arguments or update the function definition.' },
  { re: /control reaches end of non-void function/, title: 'Missing return value', explain: () => 'A function that should return a value can reach its end without a return statement.', fix: () => 'Add a return statement on every path of the function.' },
  { re: /unused variable ['‘](\w+)['’]/, title: 'Unused variable', explain: (m) => `"${m[1]}" is declared but never used.`, fix: () => 'Remove the variable or use it.' },
  { re: /undefined reference to [`'‘]WinMain|undefined reference to [`'‘]main/, title: 'No main function', explain: () => 'The linker could not find main(), so there is no program entry point.', fix: () => 'Add int main() { ... return 0; }.' },
  { re: /undefined reference to [`'‘](\w+)/, title: 'Undefined function', explain: (m) => `${m[1]} is declared but its definition was not found when linking.`, fix: (m) => `Implement ${m[1]}() or check the spelling of the call.` },
  { re: /lvalue required as left operand of assignment/, title: 'Invalid assignment target', explain: () => 'The left side of "=" is not a variable (e.g. "a + b = c" or a comparison typo).', fix: () => 'Put a variable on the left side, or use "==" if you meant to compare.' },
  { re: /suggest parentheses around assignment used as truth value/, title: 'Assignment in condition', explain: () => 'An "=" was used inside an if/while condition, which assigns instead of comparing.', fix: () => 'Use "==" to compare values.' },
  { re: /invalid conversion from ['‘]([^'’]+)['’] to ['‘]([^'’]+)['’]|incompatible types? (?:when assigning|in assignment|for argument)/, title: 'Type mismatch', explain: (m) => (m[1] ? `A ${m[1]} value is used where a ${m[2]} is required.` : 'A value of the wrong type is assigned or passed.'), fix: () => 'Convert the value explicitly or change the variable type.' },
  { re: /array subscript is not an integer/, title: 'Non-integer array index', explain: () => 'Array indexes must be integers.', fix: () => 'Use an int expression as the index (cast if necessary).' },
  { re: /stray ['‘]\\?(\d+|.)['’] in program/, title: 'Invalid character', explain: () => 'The source contains a character the compiler does not understand (often a smart quote copied from a document).', fix: () => 'Retype the quotes (") and other symbols on that line.' },
  { re: /expected ['‘]\)['’] before/, title: 'Missing parenthesis', explain: () => 'A ")" is missing, typically in a function call or condition.', fix: () => 'Balance the parentheses on the reported line.' },
  { re: /expected expression before/, title: 'Incomplete expression', explain: () => 'An operator or keyword appears where a value was expected.', fix: () => 'Check for a missing operand, extra comma or misplaced keyword.' },
];

const JAVAC: Rule[] = [
  { re: /error: ['‘];['’] expected/, title: 'Missing semicolon', explain: () => 'Java statements must end with ";".', fix: () => 'Add ";" at the end of the reported line.' },
  { re: /error: cannot find symbol[\s\S]*?symbol:\s+(?:variable|method|class)\s+(\w+)/, title: 'Unknown symbol', explain: (m) => `"${m[1]}" is not defined — it may be misspelled, undeclared or missing an import.`, fix: (m) => (['Scanner', 'ArrayList', 'HashMap', 'Arrays', 'List', 'Map'].includes(m[1]) ? 'Add "import java.util.*;" at the top of the file.' : `Declare ${m[1]} or fix its spelling.`) },
  { re: /error: incompatible types: possible lossy conversion from (\w+) to (\w+)/, title: 'Lossy conversion', explain: (m) => `Converting ${m[1]} to ${m[2]} could lose information, so Java requires an explicit cast.`, fix: (m) => `Cast explicitly: (${m[2]}) value.` },
  { re: /error: incompatible types: (\w+) cannot be converted to (\w+)/, title: 'Type mismatch', explain: (m) => `A ${m[1]} is used where a ${m[2]} is required.`, fix: (m) => (m[1] === 'String' && m[2] === 'int' ? 'Use Integer.parseInt(text).' : 'Change the variable type or convert the value.') },
  { re: /error: missing return statement/, title: 'Missing return', explain: () => 'A method with a return type can finish without returning a value.', fix: () => 'Add a return statement at the end of the method.' },
  { re: /error: variable (\w+) might not have been initialized/, title: 'Uninitialised variable', explain: (m) => `${m[1]} is read before it is guaranteed to have a value.`, fix: (m) => `Give ${m[1]} an initial value when declaring it.` },
  { re: /error: reached end of file while parsing/, title: 'Missing closing brace', explain: () => 'The file ended while a class or method body was still open.', fix: () => 'Add the missing "}".' },
  { re: /error: unreachable statement/, title: 'Unreachable code', explain: () => 'This statement can never run (for example it follows a return or break).', fix: () => 'Remove it or move it before the return/break.' },
  { re: /non-static (?:method|variable) (\w+)[^\n]* cannot be referenced from a static context/, title: 'Static context', explain: (m) => `${m[1]} belongs to an object, but main() is static.`, fix: (m) => `Declare ${m[1]} as static, or create an object and call it on that object.` },
  { re: /error: class (\w+) is public, should be declared in a file named/, title: 'Class / file name mismatch', explain: () => 'Java requires the public class name to match the file name.', fix: () => 'CodePilot names the file after your public class automatically; check for two public classes.' },
  { re: /error: ['‘]\)['’] expected|error: ['‘]\(['’] expected/, title: 'Missing parenthesis', explain: () => 'Parentheses are unbalanced.', fix: () => 'Add the missing parenthesis on the reported line.' },
  { re: /error: illegal start of expression/, title: 'Illegal start of expression', explain: () => 'Usually a missing brace or a method declared inside another method.', fix: () => 'Check braces around the reported line.' },
];

const PY: Rule[] = [
  { re: /SyntaxError: expected ['‘]:['’]/, title: 'Missing colon', explain: () => 'Statements that start a block (if, for, while, def, class) must end with ":".', fix: () => 'Add ":" at the end of the reported line.' },
  { re: /IndentationError: (.+)/, title: 'Indentation error', explain: (m) => `Python uses indentation to group statements: ${m[1]}.`, fix: () => 'Indent the block consistently with 4 spaces; do not mix tabs and spaces.' },
  { re: /NameError: name ['‘](\w+)['’] is not defined/, title: 'Undefined name', explain: (m) => `"${m[1]}" is used before it was assigned (or is misspelled).`, fix: (m) => `Assign ${m[1]} before using it or fix the spelling.` },
  { re: /TypeError: can only concatenate str \(not "(\w+)"\) to str|TypeError: unsupported operand type\(s\) for \+: '(\w+)' and '(\w+)'/, title: 'Mixing text and numbers', explain: () => 'Python does not convert numbers to strings automatically when using +.', fix: () => 'Use an f-string (f"Total: {x}") or str(x).' },
  { re: /ZeroDivisionError/, title: 'Division by zero', explain: () => 'The program divided a number by zero.', fix: () => 'Check the divisor before dividing.' },
  { re: /IndexError: (list|string) index out of range/, title: 'Index out of range', explain: (m) => `The code accessed a ${m[1]} position that does not exist.`, fix: () => 'Valid indexes are 0 … len(x) - 1; check loop bounds.' },
  { re: /ValueError: invalid literal for int\(\) with base 10: '(.*)'/, title: 'Invalid number input', explain: (m) => `int() received "${m[1]}", which is not a whole number.`, fix: () => 'Make sure the STDIN panel contains numbers in the expected format (one per line or space separated).' },
  { re: /EOFError/, title: 'Missing input', explain: () => 'The program asked for input but the STDIN panel had no more data.', fix: () => 'Enter the required input values in the STDIN panel before running.' },
  { re: /RecursionError/, title: 'Too much recursion', explain: () => 'The recursion never reached its base case (or the input is too large).', fix: () => 'Check the base case and that each call moves toward it.' },
  { re: /KeyError: (.+)/, title: 'Missing dictionary key', explain: (m) => `The key ${m[1]} does not exist in the dictionary.`, fix: () => 'Use dict.get(key, default) or check "key in dict" first.' },
  { re: /AttributeError: '(\w+)' object has no attribute '(\w+)'/, title: 'Unknown attribute', explain: (m) => `Values of type ${m[1]} have no attribute/method "${m[2]}".`, fix: () => 'Check the method name and the type of the value.' },
  { re: /TypeError: (.+)/, title: 'Type error', explain: (m) => m[1], fix: () => 'Check that values have the types the operation expects.' },
  { re: /SyntaxError: (.+)/, title: 'Syntax error', explain: (m) => m[1], fix: () => 'Look at the reported line (and the one above it) for typos.' },
  { re: /PermissionError: CodePilot execution guard: (.+)/, title: 'Blocked by execution guard', explain: (m) => m[1], fix: () => 'Programs run in CodePilot cannot write files, start processes or use the network.' },
];

const NODE: Rule[] = [
  { re: /ReferenceError: (\w+) is not defined/, title: 'Undefined variable', explain: (m) => `"${m[1]}" is used but was never declared.`, fix: (m) => `Declare it with let/const before use, or fix the spelling of ${m[1]}.` },
  { re: /TypeError: (\S+) is not a function/, title: 'Not a function', explain: (m) => `${m[1]} is called like a function but it is not one.`, fix: () => 'Check the name and that the value is a function.' },
  { re: /TypeError: Cannot read propert(?:y|ies) of (undefined|null)/, title: 'Undefined value access', explain: (m) => `Code tried to read a property of ${m[1]}.`, fix: () => 'Make sure the object/array element exists before accessing it.' },
  { re: /TypeError: Assignment to constant variable/, title: 'Reassigning a const', explain: () => 'A const variable cannot be reassigned.', fix: () => 'Declare it with let instead of const.' },
  { re: /RangeError: Maximum call stack size exceeded/, title: 'Infinite recursion', explain: () => 'The recursion never stopped.', fix: () => 'Check the base case.' },
  { re: /SyntaxError: (.+)/, title: 'Syntax error', explain: (m) => m[1], fix: () => 'Check brackets, quotes and commas near the reported line.' },
  { re: /ERR_ACCESS_DENIED/, title: 'Blocked by execution guard', explain: () => 'The Node.js permission model blocked file-system or process access.', fix: () => 'Programs run in CodePilot cannot write files or start processes.' },
];

const JAVA_RT: Rule[] = [
  { re: /ArrayIndexOutOfBoundsException: (?:Index )?(-?\d+)/, title: 'Array index out of bounds', explain: (m) => `Index ${m[1]} is outside the valid range of the array.`, fix: () => 'Valid indexes are 0 … length - 1; check loop conditions (use < length).' },
  { re: /StringIndexOutOfBoundsException/, title: 'String index out of bounds', explain: () => 'A character position outside the string was accessed.', fix: () => 'Check index bounds against s.length().' },
  { re: /NullPointerException/, title: 'Null reference', explain: () => 'A method or field was used on a null reference.', fix: () => 'Initialise the object before use.' },
  { re: /ArithmeticException: \/ by zero/, title: 'Division by zero', explain: () => 'An integer was divided by zero.', fix: () => 'Check the divisor before dividing.' },
  { re: /InputMismatchException/, title: 'Wrong input type', explain: () => 'Scanner expected a number but found something else.', fix: () => 'Check the values in the STDIN panel.' },
  { re: /NoSuchElementException/, title: 'Missing input', explain: () => 'Scanner tried to read more input than was provided.', fix: () => 'Provide all required input values in the STDIN panel.' },
  { re: /NumberFormatException: For input string: "(.*)"/, title: 'Invalid number', explain: (m) => `"${m[1]}" cannot be parsed as a number.`, fix: () => 'Check the input format.' },
  { re: /StackOverflowError/, title: 'Stack overflow', explain: () => 'Recursion went too deep (missing or unreachable base case).', fix: () => 'Check the base case of recursive methods.' },
];

const WIN_EXIT: Record<number, [string, string, string]> = {
  3221225477: ['Access violation (segmentation fault)', 'The program read or wrote memory it does not own — usually an array index out of bounds, an uninitialised pointer, or a missing & in scanf.', 'Check array bounds and pointer usage.'],
  3221225620: ['Integer division by zero', 'An integer was divided by zero.', 'Check the divisor before dividing.'],
  3221225725: ['Stack overflow', 'Recursion went too deep or a very large local array was declared.', 'Check the recursion base case or allocate big arrays globally.'],
  3221226505: ['Fatal runtime error', 'The C runtime aborted the program (buffer overrun or invalid operation).', 'Check array bounds and string buffers.'],
  139: ['Segmentation fault', 'Invalid memory access.', 'Check array bounds and pointers.'],
};

function headerFor(fn: string): string | null {
  if (['printf', 'scanf', 'puts', 'gets', 'fgets', 'getchar', 'putchar', 'fprintf', 'sprintf'].includes(fn)) return 'stdio.h';
  if (['strlen', 'strcpy', 'strcmp', 'strcat', 'strncpy', 'memset', 'memcpy'].includes(fn)) return 'string.h';
  if (['sqrt', 'pow', 'fabs', 'floor', 'ceil', 'sin', 'cos', 'log'].includes(fn)) return 'math.h';
  if (['malloc', 'free', 'abs', 'rand', 'srand', 'exit', 'atoi', 'qsort', 'calloc'].includes(fn)) return 'stdlib.h';
  return null;
}

function lineOf(text: string, lang: Lang): number | null {
  let m: RegExpMatchArray | null = null;
  if (lang === 'c' || lang === 'cpp') m = text.match(/main\.c(?:pp)?:(\d+):/);
  else if (lang === 'java') m = text.match(/\.java:(\d+):/) ?? text.match(/\.java:(\d+)\)/);
  else if (lang === 'python') {
    const all = [...text.matchAll(/File "main\.py", line (\d+)/g)];
    if (all.length) return Number(all[all.length - 1][1]);
  } else if (lang === 'javascript') m = text.match(/main\.js:(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Split compiler/runtime output into individual messages and explain each one. */
export function interpretErrors(output: string, lang: Lang, phase: 'compile' | 'runtime', exitCode?: number | null): Diagnosis[] {
  const res: Diagnosis[] = [];
  const text = output.replace(/\r/g, '');
  const rules = lang === 'c' || lang === 'cpp' ? GCC : lang === 'java' ? (phase === 'compile' ? JAVAC : JAVA_RT) : lang === 'python' ? PY : NODE;
  let chunks: string[];
  if (lang === 'c' || lang === 'cpp') chunks = text.split('\n').filter((l) => /(error|warning):/.test(l)).map((l, i, arr) => l + (arr[i + 1] ? '' : ''));
  else if (lang === 'java' && phase === 'compile') chunks = text.split(/\n(?=\S*\.java:\d+: (?:error|warning))/);
  else chunks = [text];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const isWarning = /warning:/.test(chunk) && !/error:/.test(chunk);
    let matched = false;
    for (const r of rules) {
      const m = chunk.match(r.re);
      if (m) {
        res.push({ line: lineOf(chunk, lang), severity: isWarning ? 'warning' : 'error', title: r.title, explanation: r.explain(m), suggestion: r.fix(m), raw: chunk.trim().slice(0, 500) });
        matched = true;
        break;
      }
    }
    if (!matched && /error/i.test(chunk)) {
      const msg = chunk.match(/error:\s*(.+)/)?.[1] ?? chunk.trim().split('\n').pop() ?? chunk;
      res.push({ line: lineOf(chunk, lang), severity: 'error', title: 'Compiler message', explanation: msg.slice(0, 300), suggestion: 'Look at the reported line and the line just above it.', raw: chunk.trim().slice(0, 500) });
    }
  }
  if (!res.length && phase === 'runtime' && exitCode && WIN_EXIT[exitCode]) {
    const [title, explanation, suggestion] = WIN_EXIT[exitCode];
    res.push({ line: null, severity: 'error', title, explanation: `${explanation} (exit code ${exitCode})`, suggestion, raw: '' });
  }
  return res;
}

// ------------------------------------------------------------------ repair
export interface RepairChange {
  line: number;
  description: string;
}
export interface RepairResult {
  fixed: string;
  changes: RepairChange[];
}

/** Apply safe, mechanical fixes for common mistakes. Every change is reported. */
export function repairCode(code: string, lang: Lang, diagnostics: Diagnosis[] = []): RepairResult {
  const nl = code.includes('\r\n') ? '\r\n' : '\n';
  let lines = code.split(/\r?\n/);
  const changes: RepairChange[] = [];
  const cfam = lang !== 'python';
  const textAll = () => lines.join('\n');

  // 1. missing semicolons reported by the compiler
  for (const d of diagnostics) {
    if (d.title === 'Missing semicolon' && d.line) {
      // gcc reports the line AFTER the missing semicolon; javac reports the line itself
      const candidates = lang === 'java' ? [d.line - 1] : [d.line - 2, d.line - 1];
      for (const idx of candidates) {
        const l = lines[idx];
        if (l !== undefined && /[\w)\]"']\s*$/.test(l) && !/^\s*(\/\/|#|if|for|while|else|switch|do)\b/.test(l.trim()) && !/[{};,]\s*$/.test(l)) {
          lines[idx] = l.replace(/\s*$/, ';');
          changes.push({ line: idx + 1, description: 'Added missing semicolon.' });
          break;
        }
      }
    }
  }
  if (cfam) {
    lines = lines.map((l, i) => {
      const t = l.trim();
      // possible missing semicolon on simple declarations / assignments
      const next = (lines[i + 1] ?? '').trim();
      if (!changes.some((c) => c.line === i + 1) && /^(int|long|float|double|char|bool|boolean|String|string|return\b)[^;{}()]*[\w\]"']$/.test(t) && !/^[.+\-*/&|?:]/.test(next) && lang !== 'javascript') {
        changes.push({ line: i + 1, description: 'Added missing semicolon.' });
        return l.replace(/\s*$/, ';');
      }
      // if (x = 5) -> if (x == 5)
      const m = l.match(/^(\s*(?:if|while)\s*\(\s*)([A-Za-z_]\w*)\s*=\s*([^=][^)]*)\)/);
      if (m && !/[<>!=]=/.test(m[3])) {
        changes.push({ line: i + 1, description: `Replaced assignment "=" with comparison "==" in the condition.` });
        return l.replace(/^(\s*(?:if|while)\s*\(\s*[A-Za-z_]\w*\s*)=(\s*[^=])/, '$1==$2');
      }
      // semicolon right after if/for/while
      if (/^\s*(if|for|while)\s*\(.*\)\s*;\s*$/.test(l) && /^\s*\{/.test(lines[i + 1] ?? '')) {
        changes.push({ line: i + 1, description: 'Removed the stray ";" that made the loop/condition body empty.' });
        return l.replace(/\)\s*;\s*$/, ')');
      }
      // scanf missing &
      if ((lang === 'c' || lang === 'cpp') && /scanf\s*\(\s*"/.test(l)) {
        const fixed = l.replace(/(scanf\s*\(\s*"[^"]*")([^)]*)\)/, (_all, fmt: string, args: string) => {
          const specs = fmt.match(/%[0-9]*l*[a-z]/g) ?? [];
          const parts = args.split(',').map((a) => a.trim());
          const out = parts.map((a, k) => (k === 0 ? a : a && !a.startsWith('&') && /^[A-Za-z_]\w*$/.test(a) && !/%s/.test(specs[k - 1] ?? '') ? '&' + a : a));
          return `${fmt}${out.join(', ').replace(/^, /, ', ')})`;
        });
        if (fixed !== l) {
          changes.push({ line: i + 1, description: 'Added "&" so scanf() receives the variable address.' });
          return fixed;
        }
      }
      // Java string comparison
      if (lang === 'java') {
        const sm = l.match(/(\b[a-z]\w*)\s*==\s*("(?:[^"\\]|\\.)*")/);
        if (sm) {
          changes.push({ line: i + 1, description: 'Compare strings with .equals() instead of ==.' });
          return l.replace(sm[0], `${sm[1]}.equals(${sm[2]})`);
        }
      }
      return l;
    });
    // headers / imports
    const src = textAll();
    if (lang === 'c') {
      const need: [RegExp, string][] = [
        [/\b(printf|scanf|puts|getchar|fgets)\s*\(/, 'stdio.h'],
        [/\b(strlen|strcpy|strcmp|strcat)\s*\(/, 'string.h'],
        [/\b(sqrt|pow|fabs|floor|ceil)\s*\(/, 'math.h'],
        [/\b(malloc|free|abs|rand|atoi|exit)\s*\(/, 'stdlib.h'],
        [/\bbool\b|\btrue\b|\bfalse\b/, 'stdbool.h'],
      ];
      for (const [re, h] of need) {
        if (re.test(src) && !new RegExp(`#\\s*include\\s*<${h.replace('.', '\\.')}>`).test(src)) {
          lines.unshift(`#include <${h}>`);
          changes.forEach((c) => c.line++);
          changes.push({ line: 1, description: `Added #include <${h}>.` });
        }
      }
    }
    if (lang === 'cpp') {
      if (/\b(cout|cin|endl)\b/.test(src) && !/#\s*include\s*<(iostream|bits\/stdc\+\+\.h)>/.test(src)) {
        lines.unshift('#include <iostream>');
        changes.forEach((c) => c.line++);
        changes.push({ line: 1, description: 'Added #include <iostream>.' });
      }
      if (/(?<!std::)\b(cout|cin|endl|vector|string)\b/.test(src) && !/using\s+namespace\s+std/.test(src) && !/std::(cout|cin)/.test(src)) {
        const idx = lines.findLastIndex((l) => /^\s*#\s*include/.test(l));
        lines.splice(idx + 1, 0, 'using namespace std;');
        changes.forEach((c) => c.line > idx + 1 && c.line++);
        changes.push({ line: idx + 2, description: 'Added "using namespace std;".' });
      }
    }
    if (lang === 'java' && /\b(Scanner|ArrayList|HashMap|Arrays|List<|Map<)\b/.test(src) && !/import\s+java\.util/.test(src)) {
      lines.unshift('import java.util.*;');
      changes.forEach((c) => c.line++);
      changes.push({ line: 1, description: 'Added "import java.util.*;".' });
    }
    // unbalanced braces
    const s2 = textAll().replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '');
    const diff = s2.split('{').length - s2.split('}').length;
    if (diff > 0 && diff < 4) {
      for (let k = 0; k < diff; k++) lines.push('}');
      changes.push({ line: lines.length, description: `Added ${diff} missing closing brace${diff > 1 ? 's' : ''} at the end.` });
    }
  } else {
    lines = lines.map((l, i) => {
      const t = l.trim();
      if (/^(if|elif|else|for|while|def|class|try|except|finally|with)\b/.test(t) && !t.endsWith(':') && !/[(\[,\\]$/.test(t) && !t.includes('#')) {
        changes.push({ line: i + 1, description: 'Added missing colon at the end of the block header.' });
        return l.replace(/\s*$/, ':');
      }
      const pm = l.match(/^(\s*)print\s+([^(=].*)$/);
      if (pm) {
        changes.push({ line: i + 1, description: 'Converted Python 2 print statement to print().' });
        return `${pm[1]}print(${pm[2].trim()})`;
      }
      if (/^\s*(if|while|elif)\s/.test(l) && /[^=!<>]=[^=]/.test(t) && !/[=!<>]=/.test(t)) {
        changes.push({ line: i + 1, description: 'Replaced "=" with "==" in the condition.' });
        return l.replace(/([^=!<>])=([^=])/, '$1==$2');
      }
      if (/^\t+/.test(l)) {
        changes.push({ line: i + 1, description: 'Replaced tab indentation with spaces.' });
        return l.replace(/^\t+/, (m) => '    '.repeat(m.length));
      }
      return l;
    });
  }
  return { fixed: lines.join(nl), changes: changes.sort((a, b) => a.line - b.line) };
}
