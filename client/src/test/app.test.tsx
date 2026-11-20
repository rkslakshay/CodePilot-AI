import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';

// Monaco and Mermaid need a real browser; replace them with light stand-ins for unit tests.
vi.mock('@/components/code/CodeEditor', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: { value: string; onChange?: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel ?? 'Code editor'} data-testid="code-editor" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
  DiffView: () => <div data-testid="diff" />,
}));
vi.mock('@/components/code/Mermaid', () => ({ MermaidDiagram: ({ code }: { code: string }) => <pre data-testid="mermaid">{code}</pre> }));

import { routes } from '@/App';
import { Toaster, ConfirmHost } from '@/components/ui/overlay';
import { Button } from '@/components/ui/primitives';
import { EngineBadge } from '@/components/common';
import { useSettings, useUi, DEFAULT_SETTINGS } from '@/store';

type Handler = (url: string, init?: RequestInit) => unknown;
let handlers: Record<string, Handler> = {};
const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, code: string, message: string) => new Response(JSON.stringify({ ok: false, error: { code, message } }), { status, headers: { 'content-type': 'application/json' } });

const DASH = {
  totals: { activities: 3, generations: 2, conversions: 1, explanations: 0, algorithms: 0, executions: 0, executionSuccessRate: null, debugSessions: 0, learning: 0, projects: 1, files: 2, savedAlgorithms: 0, topicsCompleted: 1, topicsTotal: 11, quizAccuracy: null, streakDays: 1 },
  languages: [{ language: 'python', count: 3 }],
  activity: Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(i + 1).padStart(2, '0')}`, count: i % 3 })),
  recentProjects: [{ id: 1, name: 'My Algorithms', description: '', language: 'python', isDemo: false, createdAt: '2026-11-10 10:00:00', updatedAt: '2026-11-10 10:00:00', fileCount: 2 }],
  recentFiles: [],
  recentGenerations: [{ id: 5, kind: 'generation', title: 'Prime check', language: 'c', targetLanguage: null, engine: 'template', status: 'success', isDemo: false, createdAt: '2026-11-10 10:00:00' }],
  recentConversions: [],
  recentActivity: [],
  savedAlgorithms: [],
  hasDemoData: false,
};

beforeEach(() => {
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS }, loaded: true });
  useUi.setState({ paletteOpen: false, mobileNav: false });
  handlers = {
    'GET /api/settings': () => ok(DEFAULT_SETTINGS),
    'GET /api/profile': () => ok({ id: 1, name: 'Local Developer' }),
    'GET /api/ai/status': () => ok({ provider: 'ollama', reachable: false, models: [], configured: false, selectedModel: '', modelInstalled: false, mode: 'offline', url: 'http://127.0.0.1:11434' }),
    'GET /api/dashboard': () => ok(DASH),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const key = `${init?.method ?? 'GET'} ${url.split('?')[0]}`;
      const h = handlers[key];
      if (!h) return fail(404, 'not_found', `unmocked ${key}`);
      return h(url, init) as Response;
    }),
  );
});

function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <>
      <RouterProvider router={router} />
      <Toaster />
      <ConfirmHost />
    </>,
  );
}

describe('navigation & shell', () => {
  it('renders every primary navigation item', async () => {
    renderApp('/');
    const nav = screen.getByRole('complementary', { name: /primary navigation/i });
    for (const label of ['Dashboard', 'AI Code Generator', 'Code Converter', 'Algorithm Studio', 'Code Explainer', 'Compiler & Debugger', 'Learning Hub', 'My Workspace', 'History', 'Settings']) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it('shows dashboard statistics from the API', async () => {
    renderApp('/');
    expect(await screen.findByText('Welcome to CodePilot AI')).toBeInTheDocument();
    expect(screen.getByText('My Algorithms')).toBeInTheDocument();
    expect(screen.getByText('Prime check')).toBeInTheDocument();
    expect(screen.getByText('1/11')).toBeInTheDocument();
  });

  it('navigates between modules', async () => {
    handlers['GET /api/algorithms'] = () => ok([{ id: 'bubble-sort', name: 'Bubble Sort', category: 'Sorting', summary: 'Swap neighbours', difficulty: 'Easy', complexity: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)' }, visual: 'sort' }]);
    renderApp('/');
    await screen.findByText('Welcome to CodePilot AI');
    await userEvent.click(within(screen.getByRole('complementary', { name: /primary navigation/i })).getByText('Algorithm Studio'));
    expect(await screen.findByText('Bubble Sort')).toBeInTheDocument();
  });

  it('shows an AI status indicator in offline mode', async () => {
    renderApp('/');
    expect(await screen.findByLabelText(/AI status: Offline mode/i)).toBeInTheDocument();
  });

  it('opens the command palette with Ctrl+K and filters commands', async () => {
    renderApp('/');
    await screen.findByText('Welcome to CodePilot AI');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('Command');
    await userEvent.type(input, 'convert');
    expect(screen.getByText('Go to Code Converter')).toBeInTheDocument();
    expect(screen.queryByText('Go to History')).not.toBeInTheDocument();
  });

  it('shows a not-found page for unknown routes', async () => {
    renderApp('/does-not-exist');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
  });
});

describe('error states', () => {
  it('shows an error when the dashboard cannot load', async () => {
    handlers['GET /api/dashboard'] = () => fail(500, 'internal_error', 'Database locked');
    renderApp('/');
    expect(await screen.findByText('Database locked')).toBeInTheDocument();
  });
});

describe('code generator form', () => {
  it('validates the problem description', async () => {
    renderApp('/generator');
    await screen.findByLabelText('Problem description');
    await waitFor(() => expect(screen.getByLabelText(/AI status/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /Generate code/i }));
    expect(await screen.findByText(/Describe the programming problem/)).toBeInTheDocument();
  });

  it('shows a loading state and renders an honestly-labelled result', async () => {
    let resolve!: (r: Response) => void;
    handlers['POST /api/generate'] = () => new Promise<Response>((r) => (resolve = r));
    renderApp('/generator');
    await userEvent.type(await screen.findByLabelText('Problem description'), 'check if a number is prime');
    await userEvent.click(screen.getByRole('button', { name: /Generate code/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Generate code/i })).toBeDisabled());
    resolve(
      ok({
        engine: { kind: 'template', label: 'Built-in template · Prime (offline, not AI-generated)' },
        matched: true,
        match: { kind: 'template', id: 'prime-check', title: 'Prime check', difficulty: 'Easy' },
        alternatives: [],
        understanding: 'Decide whether n is prime',
        code: 'print("prime")\n',
        explanation: 'Trial division',
        variables: [],
        functions: [],
        timeComplexity: 'O(√n)',
        spaceComplexity: 'O(1)',
        testCases: [{ input: '7\n', expected: '7 is prime\n' }],
        edgeCases: ['n = 1'],
        issues: [],
      }),
    );
    expect(await screen.findByText(/offline, not AI-generated/)).toBeInTheDocument();
    expect((screen.getByTestId('code-editor') as HTMLTextAreaElement).value).toBe('print("prime")\n');
    expect(screen.getByText('Trial division')).toBeInTheDocument();
  });

  it('is honest when no offline solution exists', async () => {
    handlers['POST /api/generate'] = () => ok({ engine: { kind: 'offline', label: 'Offline engine (rule-based, not AI)' }, matched: false, message: 'The offline engine cannot write a solution for an arbitrary problem description', suggestions: [{ kind: 'template', id: 'x', title: 'Leap year' }], code: '# skeleton', codeIsSkeleton: true });
    renderApp('/generator');
    await userEvent.type(await screen.findByLabelText('Problem description'), 'build a social network');
    await userEvent.click(screen.getByRole('button', { name: /Generate code/i }));
    expect(await screen.findByText(/Starter skeleton — not a solution/)).toBeInTheDocument();
    expect(screen.getByText('Leap year')).toBeInTheDocument();
  });
});

describe('editor interactions & converter', () => {
  it('converts code typed into the editor and renders the comparison', async () => {
    handlers['POST /api/convert'] = (_u, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.code).toBe('x = 1\n');
      return ok({ engine: { kind: 'offline', label: 'Offline structured translator (rule-based)' }, ok: true, code: 'int x = 1;', explanation: 'done', warnings: [], notes: [], verification: 'Not verified', comparison: { logic: [{ aspect: 'Loops', original: 'none', converted: 'none', same: true }], syntaxChanges: ['Statements end with ;'], dataStructures: [], behaviouralDifferences: ['Integers overflow'] } });
    };
    renderApp('/converter');
    const editors = await screen.findAllByTestId('code-editor');
    fireEvent.change(editors[0], { target: { value: 'x = 1\n' } });
    await userEvent.click(screen.getByRole('button', { name: /^Convert$/ }));
    expect(await screen.findByText('Integers overflow')).toBeInTheDocument();
    expect((screen.getAllByTestId('code-editor')[1] as HTMLTextAreaElement).value).toBe('int x = 1;');
  });
});

describe('settings', () => {
  it('asks for confirmation before enabling code execution', async () => {
    handlers['GET /api/system/database'] = () => ok({ path: 'db', sizeBytes: 1000, schemaVersion: 1, engine: 'SQLite', tables: {}, demoRecords: 0 });
    handlers['GET /api/system/backups'] = () => ok([]);
    handlers['GET /api/meta'] = () => ok({ app: 'CodePilot AI', version: '1.0.0', node: 'v24', platform: 'win32' });
    const put = vi.fn((_u: string, init?: RequestInit) => ok({ ...DEFAULT_SETTINGS, ...JSON.parse(String(init?.body)) }));
    handlers['PUT /api/settings'] = put;
    renderApp('/settings');
    await userEvent.click(await screen.findByRole('switch', { name: 'Allow code execution' }));
    expect(await screen.findByText('Enable local code execution?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(put).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('switch', { name: 'Allow code execution' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Enable execution' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(JSON.parse(String(put.mock.calls[0][1]?.body))).toEqual({ executionEnabled: true });
  });
});

describe('components', () => {
  it('Button shows a spinner and is disabled while loading', () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: /Save/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
  it('EngineBadge labels the result source', () => {
    render(<EngineBadge engine={{ kind: 'ollama', label: 'Local AI · qwen2.5-coder' }} />);
    expect(screen.getByText('Local AI · qwen2.5-coder')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent(/local language model/);
  });
});

describe('UML PNG export sizing', () => {
  it('uses 2x for normal diagrams and shrinks very large ones to fit browser canvas limits', async () => {
    const { pngScale } = await import('@/lib/uml');
    expect(pngScale(1200, 800)).toBe(2);
    // 400 unconnected classes lay out about 84 000 px wide: 2x would exceed the 65 535 px canvas limit
    const s = pngScale(84_020, 240);
    expect(84_020 * s).toBeLessThanOrEqual(32_000);
    expect(s).toBeGreaterThan(0.3);
    // a huge square stays under the pixel-area limit
    const q = pngScale(20_000, 20_000);
    expect(20_000 * q * 20_000 * q).toBeLessThanOrEqual(120_000_000 + 1);
  });
});
