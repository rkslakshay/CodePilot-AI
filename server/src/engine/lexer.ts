import type { Lang } from './ir.js';

export type TokType = 'id' | 'num' | 'str' | 'char' | 'op' | 'nl' | 'indent' | 'dedent' | 'comment' | 'pp' | 'eof';
export interface Token {
  t: TokType;
  v: string;
  line: number;
  /** offset in source */
  pos: number;
  /** string prefix for python strings (f, r, b) */
  prefix?: string;
}

const OPS = [
  '>>>=', '>>=', '<<=', '===', '!==', '**=', '//=', '>>>', '...',
  '->', '=>', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '&&', '||', '==', '!=', '<=', '>=', '<<', '>>', '**', '//', '::', ':=',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '@',
];

export class LexError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}

/** Tokenise source code. Python gets INDENT/DEDENT/NL tokens; C-family languages skip whitespace. */
export function tokenize(src: string, lang: Lang): Token[] {
  const py = lang === 'python';
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let depth = 0; // bracket depth (python: newlines inside brackets are ignored)
  const indents = [0];
  let atLineStart = true;
  const n = src.length;

  const push = (t: TokType, v: string, pos: number, prefix?: string) => toks.push({ t, v, line, pos, prefix });

  while (i < n) {
    // python indentation handling
    if (py && atLineStart && depth === 0) {
      let col = 0;
      let j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) {
        col += src[j] === '\t' ? 4 : 1;
        j++;
      }
      // blank or comment-only lines don't affect indentation
      if (j >= n || src[j] === '\n' || src[j] === '\r' || src[j] === '#') {
        if (j < n && src[j] === '#') {
          let e = j;
          while (e < n && src[e] !== '\n') e++;
          push('comment', src.slice(j + 1, e).trim(), j);
          j = e;
        }
        if (j < n && src[j] === '\r') j++;
        if (j < n && src[j] === '\n') {
          j++;
          line++;
        }
        i = j;
        continue;
      }
      i = j;
      atLineStart = false;
      const cur = indents[indents.length - 1];
      if (col > cur) {
        indents.push(col);
        push('indent', '', i);
      } else {
        while (col < indents[indents.length - 1]) {
          indents.pop();
          push('dedent', '', i);
        }
        if (col !== indents[indents.length - 1]) throw new LexError('Inconsistent indentation', line);
      }
    }
    const c = src[i];
    if (c === '\n') {
      if (py && depth === 0) {
        if (toks.length && toks[toks.length - 1].t !== 'nl') push('nl', '', i);
        atLineStart = true;
      }
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (py && c === '\\' && src[i + 1] === '\n') {
      i += 2;
      line++;
      continue;
    }
    // comments
    if (py && c === '#') {
      let e = i;
      while (e < n && src[e] !== '\n') e++;
      push('comment', src.slice(i + 1, e).trim(), i);
      i = e;
      continue;
    }
    if (!py && c === '/' && src[i + 1] === '/') {
      let e = i;
      while (e < n && src[e] !== '\n') e++;
      push('comment', src.slice(i + 2, e).trim(), i);
      i = e;
      continue;
    }
    if (!py && c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      const text = src.slice(i + 2, e < 0 ? n : e);
      push('comment', text.replace(/^\s*\*+/gm, '').trim(), i);
      line += (text.match(/\n/g) || []).length;
      i = end;
      continue;
    }
    // preprocessor
    if (!py && c === '#' && (lang === 'c' || lang === 'cpp')) {
      let e = i;
      while (e < n && src[e] !== '\n') e++;
      push('pp', src.slice(i, e).trim(), i);
      i = e;
      continue;
    }
    // numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let e = i;
      if (c === '0' && /[xX]/.test(src[i + 1] ?? '')) {
        e += 2;
        while (e < n && /[0-9a-fA-F_]/.test(src[e])) e++;
      } else {
        while (e < n && /[0-9_.]/.test(src[e])) {
          if (src[e] === '.' && src[e + 1] === '.') break;
          e++;
        }
        if (/[eE]/.test(src[e] ?? '') && /[-+0-9]/.test(src[e + 1] ?? '')) {
          e += 2;
          while (e < n && /[0-9]/.test(src[e])) e++;
        }
      }
      while (e < n && /[lLuUfFdD]/.test(src[e])) e++;
      push('num', src.slice(i, e), i);
      i = e;
      continue;
    }
    // identifiers (and python string prefixes)
    if (/[A-Za-z_$]/.test(c)) {
      let e = i;
      while (e < n && /[A-Za-z0-9_$]/.test(src[e])) e++;
      const word = src.slice(i, e);
      if (py && /^[fFrRbBuU]{1,2}$/.test(word) && (src[e] === '"' || src[e] === "'")) {
        i = readString(e, word.toLowerCase());
        continue;
      }
      push('id', word, i);
      i = e;
      continue;
    }
    if (c === '"' || c === "'" || (c === '`' && lang === 'javascript')) {
      i = readString(i, '');
      continue;
    }
    let matched = '';
    for (const op of OPS) {
      if (src.startsWith(op, i)) {
        if (op === '//' && !py) continue;
        if ((op === '//=' || op === '**' || op === '**=') && !(py || lang === 'javascript')) continue;
        matched = op;
        break;
      }
    }
    if (!matched) throw new LexError(`Unexpected character '${c}'`, line);
    if ('([{'.includes(matched)) depth++;
    if (')]}'.includes(matched)) depth = Math.max(0, depth - 1);
    push('op', matched, i);
    i += matched.length;
  }
  if (py) {
    if (toks.length && toks[toks.length - 1].t !== 'nl') push('nl', '', n);
    while (indents.length > 1) {
      indents.pop();
      push('dedent', '', n);
    }
  }
  push('eof', '', n);
  return toks;

  function readString(start: number, prefix: string): number {
    const q = src[start];
    const triple = py && src.startsWith(q.repeat(3), start);
    let j = start + (triple ? 3 : 1);
    let out = '';
    const raw = prefix.includes('r');
    while (j < n) {
      if (triple ? src.startsWith(q.repeat(3), j) : src[j] === q) break;
      if (src[j] === '\n') {
        if (!triple && q !== '`') throw new LexError('Unterminated string literal', line);
        line++;
      }
      if (src[j] === '\\' && !raw) {
        const nx = src[j + 1];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'", '`': '`' };
        if (nx in map) {
          out += map[nx];
          j += 2;
          continue;
        }
        out += nx ?? '';
        j += 2;
        continue;
      }
      out += src[j];
      j++;
    }
    if (j >= n) throw new LexError('Unterminated string literal', line);
    const end = j + (triple ? 3 : 1);
    const isChar = q === "'" && (lang === 'c' || lang === 'cpp' || lang === 'java');
    push(isChar ? 'char' : 'str', out, start, q === '`' ? 't' : prefix);
    return end;
  }
}
