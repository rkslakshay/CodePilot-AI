import type { Lang } from '../engine/ir.js';

export interface GuardViolation {
  line: number;
  rule: string;
  text: string;
}

interface Rule {
  re: RegExp;
  rule: string;
}

// Static pre-execution scan. Blocks obviously dangerous APIs (process creation, networking,
// file modification, native code loading). It is a heuristic layer, NOT a sandbox.
const RULES: Record<Lang, Rule[]> = {
  c: [
    { re: /\b(system|popen|_popen|execl|execlp|execle|execv|execvp|execve|fork|vfork|CreateProcess\w*|ShellExecute\w*|WinExec)\s*\(/, rule: 'Process creation is blocked' },
    { re: /\b(remove|rename|unlink|rmdir|_unlink|_rmdir)\s*\(\s*["a-z_A-Z][^)]*["]|\b(remove|rename|unlink|rmdir)\s*\(\s*"|\b(DeleteFile\w*|MoveFile\w*|CopyFile\w*)\s*\(/, rule: 'File deletion / renaming is blocked' },
    { re: /\bfopen\s*\([^)]*,\s*"[^"]*[wa+]/, rule: 'Opening files for writing is blocked' },
    { re: /#\s*include\s*<\s*(windows|winsock2?|ws2tcpip|sys\/socket|netinet\/in|unistd|winreg|process|direct|io)\.h\s*>/, rule: 'System / networking headers are blocked' },
    { re: /\b(socket|connect|LoadLibrary\w*|GetProcAddress|Reg\w+Key\w*|VirtualAlloc|asm|__asm__)\s*\(/, rule: 'Low-level system calls are blocked' },
  ],
  cpp: [],
  java: [
    { re: /\bRuntime\s*\.\s*getRuntime\b|\bProcessBuilder\b|\bProcessHandle\b/, rule: 'Process creation is blocked' },
    { re: /\bjava\.net\b|\bSocket\b|\bServerSocket\b|\bURLConnection\b|\bHttpClient\b|\bjava\.net\.http\b/, rule: 'Networking is blocked' },
    { re: /\bFileWriter\b|\bFileOutputStream\b|\bPrintWriter\s*\(\s*new\s+File|\bRandomAccessFile\b|\bFiles\s*\.\s*(write|delete|move|copy|create\w*)|\.delete\s*\(\s*\)|\.renameTo\s*\(/, rule: 'File modification is blocked' },
    { re: /\bSystem\s*\.\s*(load|loadLibrary)\b|\bsetAccessible\s*\(|\bUnsafe\b|\bjava\.lang\.reflect\b|\bClassLoader\b|\bjava\.lang\.invoke\b/, rule: 'Native code / reflection is blocked' },
  ],
  python: [
    { re: /^\s*(import|from)\s+(subprocess|socket|ctypes|multiprocessing|shutil|urllib|http|ftplib|smtplib|telnetlib|requests|asyncio\.subprocess|winreg|_winapi|pty)\b/m, rule: 'Process, networking and native modules are blocked' },
    { re: /\bos\s*\.\s*(system|popen|remove|unlink|rmdir|removedirs|rename|replace|exec\w*|spawn\w*|fork|kill|startfile|chmod|chown|mkdir|makedirs)\s*\(/, rule: 'OS process / file operations are blocked' },
    { re: /__import__\s*\(\s*['"](os|subprocess|socket|ctypes|shutil)['"]/, rule: 'Dynamic import of system modules is blocked' },
  ],
  javascript: [
    { re: /require\s*\(\s*['"](node:)?(child_process|net|http|https|http2|dgram|tls|dns|cluster|worker_threads|vm|inspector|v8)['"]\s*\)/, rule: 'Process / network modules are blocked' },
    { re: /\bimport\s+[^;]*from\s*['"](node:)?(child_process|net|http|https|http2|dgram|tls|dns|cluster|worker_threads|vm)['"]/, rule: 'Process / network modules are blocked' },
    { re: /\bprocess\s*\.\s*(binding|dlopen|kill|chdir|_linkedBinding)\b|\bfetch\s*\(|\bWebSocket\b/, rule: 'Low-level process / network access is blocked' },
  ],
};
RULES.cpp = [
  ...RULES.c,
  { re: /\b(ofstream|fstream)\b/, rule: 'Writing files with ofstream / fstream is blocked' },
  { re: /#\s*include\s*<\s*(filesystem|thread)\s*>/, rule: 'Filesystem / thread libraries are blocked' },
];

export function scanCode(code: string, lang: Lang): GuardViolation[] {
  const out: GuardViolation[] = [];
  const lines = code.split(/\r?\n/);
  for (const r of RULES[lang]) {
    if (r.re.flags.includes('m')) {
      const m = r.re.exec(code);
      if (m) {
        const line = code.slice(0, m.index).split('\n').length;
        out.push({ line, rule: r.rule, text: lines[line - 1]?.trim() ?? '' });
      }
      continue;
    }
    lines.forEach((l, i) => {
      const stripped = lang === 'python' ? l.replace(/#.*$/, '') : l.replace(/\/\/.*$/, '');
      if (r.re.test(stripped)) out.push({ line: i + 1, rule: r.rule, text: l.trim() });
    });
  }
  return out.sort((a, b) => a.line - b.line);
}
