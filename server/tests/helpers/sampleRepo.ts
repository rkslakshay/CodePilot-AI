/**
 * Writes a small multi-language repository with KNOWN issues into a temporary folder.
 * Tests locate expected lines by searching for the marker text, so line numbers are checked
 * against the real file content rather than hard-coded.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Fake credentials are assembled at runtime so this source file itself never contains a
// secret-shaped literal (CodePilot's own scanner would rightly flag it).
const FAKE_AWS = 'AKIA' + 'Q7R2XK4LMN8PZT3W';
const FAKE_GH = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

export const SAMPLE: Record<string, string> = {
  'package.json': JSON.stringify(
    { name: 'sample-shop', version: '1.0.0', main: 'src/server.js', scripts: { start: 'node src/server.js' }, dependencies: { express: '^4.19.2', react: '^18.3.1', 'left-pad': '*', lodash: '^4.17.21' }, devDependencies: { vitest: '^1.6.0' } },
    null,
    2,
  ),
  'src/server.js': [
    "const express = require('express');",
    "const { exec } = require('child_process');",
    'const app = express();',
    "const dbPassword = 'Sup3rS3cretValue!';",
    "const API_URL = 'http://api.remote-service.io/v1';",
    '',
    "app.get('/user', (req, res) => {",
    "  db.query('SELECT * FROM users WHERE id = ' + req.query.id);",
    "  exec('ls ' + req.query.dir);",
    '  const data = JSON.parse(req.query.payload);',
    '  if (data.count == 3) {',
    '    var legacy = 1;',
    '  }',
    '  return res.send(data);',
    "  console.log('never');",
    '});',
    '',
    'function risky() {',
    '  try {',
    '    eval(process.argv[2]);',
    '  } catch (e) {}',
    '  const unusedThing = 42;',
    '  const token = Math.random().toString(36);',
    '  return token;',
    '}',
    "app.use(cors({ origin: '*' }));",
    'module.exports = { risky };',
    '',
  ].join('\n'),
  'src/App.tsx': [
    "import React from 'react';",
    '',
    'export function App({ items, html }: { items: { id: number; name: string }[]; html: string }) {',
    '  // TODO: paginate the list',
    '  const first = items.find((i) => i.id === 1).name;',
    '  return <div dangerouslySetInnerHTML={{ __html: html }} title={first} />;',
    '}',
    '',
  ].join('\n'),
  'app/main.py': [
    'import os',
    'import pickle',
    'import re',
    'import hashlib',
    'import yaml',
    '',
    '',
    'def loadUser(path):',
    '    f = open(path)',
    '    data = pickle.load(f)',
    '    unused_value = 10',
    '    return data',
    '',
    '',
    'def run(cmd, text):',
    '    os.system(f"echo {cmd}")',
    '    m = re.match(r"(\\d+)", text).group(1)',
    '    digest = hashlib.md5(text.encode()).hexdigest()',
    '    cfg = yaml.load(text)',
    '    try:',
    '        int(text)',
    '    except:',
    '        pass',
    '    return m, digest, cfg',
    '',
    '',
    'def classify(a, b, c, d, e, f, g):',
    '    if a:',
    '        if b:',
    '            if c:',
    '                if d:',
    '                    if e:',
    '                        return 1',
    '    if a and b or c and d:',
    '        return 2',
    '    for x in range(3):',
    '        if x == 1 or x == 2:',
    '            continue',
    '    while f:',
    '        f -= 1',
    '        if f > 10 and g:',
    '            break',
    '        elif f > 5 or g:',
    '            pass',
    '        elif f > 3:',
    '            pass',
    '    return 3 if a else 4 if b else 5',
    '',
    '',
    "if __name__ == '__main__':",
    '    app_debug = True',
    "    print(run('x', '1'))",
    '',
  ].join('\n'),
  'java/Main.java': [
    'import java.io.*;',
    'import java.security.MessageDigest;',
    '',
    'public class Main {',
    '    public static void main(String[] args) throws Exception {',
    '        Runtime.getRuntime().exec("rm " + args[0]);',
    '        String out = "";',
    '        for (int i = 0; i < 10; i++) {',
    '            out += i;',
    '        }',
    '        BufferedReader r = new BufferedReader(new FileReader(args[1]));',
    '        int n = Integer.parseInt(args[2]);',
    '        MessageDigest md = MessageDigest.getInstance("MD5");',
    '        try {',
    '            System.out.println(out + n + r.readLine() + md);',
    '        } catch (Exception e) {',
    '        }',
    '    }',
    '}',
    '',
    'class helper {',
    '}',
    '',
  ].join('\n'),
  'c/util.c': [
    '#include <stdio.h>',
    '#include <string.h>',
    '#include <stdlib.h>',
    '',
    'int count(char *s) {',
    '    int n = 0;',
    '    for (int i = 0; i < strlen(s); i++) {',
    "        if (s[i] = 'a') n++;",
    '    }',
    '    return n;',
    '}',
    '',
    'int main(void) {',
    '    char buf[16];',
    '    char dst[8];',
    '    gets(buf);',
    '    strcpy(dst, buf);',
    '    FILE *fp = fopen("out.txt", "w");',
    '    int v = atoi(buf);',
    '    if (0) {',
    '        printf("never\\n");',
    '    }',
    '    fprintf(fp, "%d %d\\n", v, count(buf));',
    '    return 0;',
    '}',
    '',
  ].join('\n'),
  'src/a.js': dupBlock('alpha'),
  'src/b.js': dupBlock('beta'),
  'config/keys.js': [`module.exports = { aws: '${FAKE_AWS}', gh: '${FAKE_GH}' };`, ''].join('\n'),
  '.env': 'DATABASE_PASSWORD=do-not-read-me-1234\n',
  '.env.example': 'DATABASE_PASSWORD=\n',
  '.gitignore': ['*.log', 'secret_dir/', ''].join('\n'),
  'debug.log': 'ignored by .gitignore\n',
  'secret_dir/hidden.js': "console.log('ignored dir');\n",
  'node_modules/leftpad/index.js': "module.exports = () => 'ignored';\n",
  'dist/bundle.js': "console.log('build output');\n",
  'tests/test_main.py': ['from app.main import run', '', '', 'def test_run():', "    assert run('a', '1')[0] == '1'", ''].join('\n'),
  'README.md': ['# Sample shop', '', 'Example repository used by CodePilot tests.', ''].join('\n'),
  'requirements.txt': ['flask==3.0.3', 'pyyaml', 'requests>=2.0', 'flask==3.0.3', ''].join('\n'),
  'empty.py': '',
};

function dupBlock(tag: string): string {
  return [
    `// module ${tag}`,
    'function normalise(items) {',
    '  const out = [];',
    '  for (const item of items) {',
    '    const name = String(item.name).trim().toLowerCase();',
    '    const price = Math.round(Number(item.price) * 100) / 100;',
    '    const qty = Math.max(0, Math.floor(Number(item.qty) || 0));',
    '    const total = Math.round(price * qty * 100) / 100;',
    '    const label = `${name} x${qty}`;',
    '    out.push({ name, price, qty, total, label });',
    '  }',
    '  out.sort((x, y) => x.name.localeCompare(y.name));',
    '  return out.filter((x) => x.qty > 0);',
    '}',
    `module.exports = { normalise, tag: '${tag}' };`,
    '',
  ].join('\n');
}

export function writeSampleRepo(dir: string, extra: Record<string, string | Buffer> = {}): string {
  for (const [rel, content] of Object.entries({ ...SAMPLE, ...extra })) {
    const abs = join(dir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  // a binary file
  writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]));
  writeFileSync(join(dir, 'data.bin.txt'), Buffer.from([0x61, 0x00, 0x62]));
  return dir;
}

/** 1-based line of the first line containing `needle` in a SAMPLE file. */
export function lineOf(file: string, needle: string): number {
  const i = SAMPLE[file].split('\n').findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i + 1;
}
