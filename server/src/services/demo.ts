/**
 * Demonstration content. Every record created here is flagged is_demo = 1 so it is clearly
 * distinguished from user data in the UI and can be removed with one click.
 * Generated outputs are produced by actually running CodePilot's offline engines.
 */
import { getDb, PROFILE_ID, tx } from '../database/db.js';
import { addHistory, createProject, createFile, saveAlgorithm, setTopicStatus, recordQuiz, saveQuestion, recordPractice } from './repo.js';
import { getAlgorithm } from './library.js';
import { TEMPLATES } from '../content/templates.js';
import { TOPICS } from '../content/learning.js';
import { translate } from '../engine/index.js';
import { analyzeCode } from '../engine/analyzer.js';
import { LANG_EXT, LANG_LABEL, type Lang } from '../engine/ir.js';

const ts = (daysAgo: number, hour: number, min = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, min, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

const BUGGY: { name: string; language: Lang; content: string }[] = [
  {
    name: 'missing_semicolon.c',
    language: 'c',
    content: `#include <stdio.h>

int main() {
    int a = 10
    int b = 20;
    printf("Sum = %d\\n", a + b);
    return 0;
}
`,
  },
  {
    name: 'off_by_one.java',
    language: 'java',
    content: `public class Main {
    public static void main(String[] args) {
        int[] marks = {78, 91, 66, 84};
        int total = 0;
        for (int i = 0; i <= marks.length; i++) {
            total += marks[i];
        }
        System.out.println("Total: " + total);
    }
}
`,
  },
  {
    name: 'missing_colon.py',
    language: 'python',
    content: `def average(values)
    total = 0
    for v in values:
        total += v
    return total / len(values)


print("Average:", average([4, 8, 15, 16, 23, 42]))
`,
  },
  {
    name: 'uninitialised_sum.c',
    language: 'c',
    content: `#include <stdio.h>

int main() {
    int n, sum;
    scanf("%d", n);
    for (int i = 1; i <= n; i++) {
        sum += i;
    }
    printf("Sum of 1..%d = %d\\n", n, sum);
    return 0;
}
`,
  },
  {
    name: 'assignment_in_condition.cpp',
    language: 'cpp',
    content: `#include <iostream>
using namespace std;

int main() {
    int score = 45;
    if (score = 100) {
        cout << "Perfect score!" << endl;
    } else {
        cout << "Score: " << score << endl;
    }
    return 0;
}
`,
  },
  {
    name: 'string_compare.java',
    language: 'java',
    content: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String answer = sc.next();
        if (answer == "yes") {
            System.out.println("Confirmed");
        } else {
            System.out.println("Cancelled");
        }
    }
}
`,
  },
];

export function loadDemoData() {
  clearDemoData();
  const counts = { projects: 0, files: 0, history: 0, savedAlgorithms: 0, questions: 0 };
  tx(() => {
    // ---------------- projects & files
    const dsa = createProject({ name: 'DSA Practice (demo)', description: 'Classic algorithms in five languages, taken from the Algorithm Studio library.', language: 'mixed', isDemo: true }) as any;
    counts.projects++;
    const dsaFiles: [string, Lang][] = [
      ['bubble-sort', 'c'],
      ['binary-search', 'python'],
      ['merge-sort', 'java'],
      ['bfs', 'javascript'],
      ['stack', 'cpp'],
      ['dijkstra', 'python'],
      ['quick-sort', 'cpp'],
    ];
    for (const [id, lang] of dsaFiles) {
      const a = getAlgorithm(id)!;
      createFile(dsa.id, { name: `${id.replace(/-/g, '_')}.${LANG_EXT[lang]}`, language: lang, content: a.code[lang], isDemo: true });
      counts.files++;
    }
    const lab = createProject({ name: 'College Lab Programs (demo)', description: 'Exam-style C programs generated from built-in templates.', language: 'c', isDemo: true }) as any;
    counts.projects++;
    for (const id of ['prime-check', 'factorial-iter', 'palindrome-number', 'fibonacci-series', 'armstrong', 'gcd-lcm', 'leap-year']) {
      const t = TEMPLATES.find((x) => x.id === id)!;
      createFile(lab.id, { name: `${id.replace(/-/g, '_')}.c`, language: 'c', content: translate(t.python, 'python', 'c').code, isDemo: true });
      counts.files++;
    }
    const interview = createProject({ name: 'Interview Prep (demo)', description: 'Array and data-structure questions frequently asked in interviews.', language: 'python', isDemo: true }) as any;
    counts.projects++;
    for (const [id, lang] of [['two-sum', 'python'], ['kadane', 'python'], ['bst', 'java'], ['linked-list', 'c'], ['hash-table', 'javascript']] as [string, Lang][]) {
      const a = getAlgorithm(id)!;
      createFile(interview.id, { name: `${id.replace(/-/g, '_')}.${LANG_EXT[lang]}`, language: lang, content: a.code[lang], isDemo: true });
      counts.files++;
    }
    const dbg = createProject({ name: 'Debugging Scenarios (demo)', description: 'Programs with deliberate bugs — open them in the Compiler & Debugger to see diagnostics and repairs.', language: 'mixed', isDemo: true }) as any;
    counts.projects++;
    for (const b of BUGGY) {
      createFile(dbg.id, { ...b, isDemo: true });
      counts.files++;
    }

    // ---------------- history (generated with the real offline engines)
    const gens: [string, Lang, string, number][] = [
      ['Check whether a number is prime', 'c', 'prime-check', 11],
      ['Print the fibonacci series up to n terms', 'python', 'fibonacci-series', 9],
      ['Find the GCD and LCM of two numbers', 'java', 'gcd-lcm', 6],
      ['Reverse an array in place', 'cpp', 'reverse-array', 3],
      ['Armstrong number check', 'javascript', 'armstrong', 1],
    ];
    for (const [prompt, lang, id, day] of gens) {
      const t = TEMPLATES.find((x) => x.id === id)!;
      const code = lang === 'python' ? t.python : translate(t.python, 'python', lang).code;
      const a = analyzeCode(code, lang);
      addHistory({ kind: 'generation', title: prompt, language: lang, engine: 'template', input: { prompt, language: lang, difficulty: 'easy', style: 'standard' }, output: { code, understanding: t.understanding, explanation: t.explanation, timeComplexity: a.complexity.time, spaceComplexity: a.complexity.space, testCases: t.tests, engine: { kind: 'template', label: `Built-in template · ${t.title}` } }, isDemo: true, createdAt: ts(day, 9, 15) });
      counts.history++;
    }
    const convs: [string, Lang, Lang, number][] = [
      ['bubble-sort', 'python', 'java', 10],
      ['binary-search', 'python', 'c', 7],
      ['kadane', 'python', 'cpp', 5],
      ['merge-sort', 'python', 'javascript', 2],
    ];
    for (const [id, from, to, day] of convs) {
      const a = getAlgorithm(id)!;
      const r = translate(a.code[from], from, to);
      addHistory({ kind: 'conversion', title: `${LANG_LABEL[from]} → ${LANG_LABEL[to]}`, language: from, targetLanguage: to, engine: 'offline', input: { code: a.code[from], from, to }, output: { code: r.code, warnings: r.warnings, notes: r.notes }, isDemo: true, createdAt: ts(day, 14, 30) });
      counts.history++;
    }
    for (const [id, lang, day] of [['quick-sort', 'cpp', 8], ['dfs', 'python', 4]] as [string, Lang, number][]) {
      const code = getAlgorithm(id)!.code[lang];
      const an = analyzeCode(code, lang);
      addHistory({ kind: 'explanation', title: `Explain ${LANG_LABEL[lang]} code (${an.stats.codeLines} lines)`, language: lang, engine: 'offline', input: { code, language: lang, mode: 'beginner' }, output: { summary: an.summary, complexity: an.complexity, issues: an.issues.length }, isDemo: true, createdAt: ts(day, 16) });
      counts.history++;
    }
    for (const [id, day] of [['dijkstra', 7], ['heap-sort', 4], ['bfs', 0]] as [string, number][]) {
      const a = getAlgorithm(id)!;
      addHistory({ kind: 'algorithm', title: a.name, language: 'python', engine: 'template', input: { problem: a.summary, language: 'python' }, output: { title: a.name, steps: a.steps }, isDemo: true, createdAt: ts(day, 11, 45) });
      counts.history++;
    }
    for (const [id, lang, day] of [['bubble-sort', 'c', 10], ['binary-search', 'java', 7], ['fibonacci', 'python', 5], ['bst', 'cpp', 3], ['two-sum', 'javascript', 1], ['factorial', 'c', 0]] as [string, Lang, number][]) {
      const a = getAlgorithm(id)!;
      addHistory({ kind: 'execution', title: `Run ${a.name} (${LANG_LABEL[lang]})`, language: lang, engine: 'local', status: 'success', input: { code: a.code[lang], stdin: '', language: lang }, output: { status: 'success', stdout: a.expectedOutput, stderr: '', timeMs: 40 + day * 7 }, isDemo: true, createdAt: ts(day, 15, 10) });
      counts.history++;
    }
    addHistory({ kind: 'execution', title: 'Run C program', language: 'c', engine: 'local', status: 'compile_error', input: { code: BUGGY[0].content, stdin: '', language: 'c' }, output: { status: 'compile_error', compileOutput: "main.c:5:5: error: expected ',' or ';' before 'int'" }, isDemo: true, createdAt: ts(6, 10) });
    addHistory({ kind: 'debug', title: 'Debug C program (2 findings)', language: 'c', engine: 'offline', status: 'issues', input: { code: BUGGY[3].content }, output: { diagnostics: [], issues: 2, changes: 1 }, isDemo: true, createdAt: ts(6, 10, 5) });
    addHistory({ kind: 'debug', title: 'Test run: 3/3 passed', language: 'python', engine: 'local', status: 'success', input: { code: TEMPLATES[1].python }, output: { passed: 3, total: 3 }, isDemo: true, createdAt: ts(2, 18) });
    counts.history += 3;
    for (const [topic, type, day] of [['sorting', 'MCQ quiz', 9], ['searching', 'Viva questions', 8], ['graphs', 'MCQ quiz', 2], ['recursion', 'MCQ quiz', 1]] as [string, string, number][]) {
      addHistory({ kind: 'learning', title: `${type}: ${TOPICS.find((t) => t.id === topic)!.name}`, engine: 'template', input: { topicId: topic }, output: { count: 4 }, isDemo: true, createdAt: ts(day, 20) });
      counts.history++;
    }

    // ---------------- saved algorithms
    for (const id of ['binary-search', 'merge-sort', 'dijkstra']) {
      const a = getAlgorithm(id)!;
      saveAlgorithm({ title: a.name, algorithmId: a.id, language: 'python', code: a.code.python, pseudocode: a.pseudocode, flowchart: a.flowchart, steps: a.steps, complexity: a.complexity, notes: 'Saved from the Algorithm Studio library (demo).', isDemo: true });
      counts.savedAlgorithms++;
    }

    // ---------------- learning progress
    setTopicStatus('searching', 'completed');
    setTopicStatus('sorting', 'completed');
    setTopicStatus('arrays', 'in_progress');
    setTopicStatus('recursion', 'in_progress');
    recordQuiz('sorting', 3, 4);
    recordQuiz('searching', 4, 4);
    recordQuiz('graphs', 2, 4);
    recordQuiz('recursion', 3, 4);
    for (const [topicId, idx] of [['sorting', 0], ['graphs', 1], ['trees', 2]] as [string, number][]) {
      const t = TOPICS.find((x) => x.id === topicId)!;
      saveQuestion({ topicId, type: 'viva', question: t.viva[idx].q, payload: t.viva[idx], isDemo: true });
      counts.questions++;
    }
    const mcq = TOPICS[0].mcq[0];
    saveQuestion({ topicId: TOPICS[0].id, type: 'mcq', question: mcq.q, payload: mcq, isDemo: true });
    counts.questions++;
    recordPractice({ topicId: 'arrays', problemId: 'array-missing', status: 'solved', language: 'python', isDemo: true, createdAt: ts(5, 19) });
    recordPractice({ topicId: 'stacks', problemId: 'stack-brackets', status: 'solved', language: 'java', isDemo: true, createdAt: ts(3, 19) });
    recordPractice({ topicId: 'dynamic-programming', problemId: 'dp-coins', status: 'attempted', language: 'cpp', isDemo: true, createdAt: ts(1, 21) });
  });
  return counts;
}

export function clearDemoData() {
  const d = getDb();
  const out = tx(() => {
    const r = {
      projects: Number(d.prepare('DELETE FROM projects WHERE profile_id = ? AND is_demo = 1').run(PROFILE_ID).changes),
      history: Number(d.prepare('DELETE FROM history WHERE profile_id = ? AND is_demo = 1').run(PROFILE_ID).changes),
      savedAlgorithms: Number(d.prepare('DELETE FROM saved_algorithms WHERE profile_id = ? AND is_demo = 1').run(PROFILE_ID).changes),
      questions: Number(d.prepare('DELETE FROM saved_questions WHERE profile_id = ? AND is_demo = 1').run(PROFILE_ID).changes),
      practice: Number(d.prepare('DELETE FROM practice_attempts WHERE profile_id = ? AND is_demo = 1').run(PROFILE_ID).changes),
    };
    // learning progress rows created only by demo data (no user practice/quiz outside demo)
    d.prepare(`DELETE FROM learning_progress WHERE profile_id = ? AND topic_id IN ('searching','sorting','arrays','recursion','graphs') AND NOT EXISTS (SELECT 1 FROM history h WHERE h.profile_id = ? AND h.kind = 'learning' AND h.is_demo = 0)`).run(PROFILE_ID, PROFILE_ID);
    return r;
  });
  return out;
}
