export const NAV_PAGES = [
  { path: '/', label: 'Dashboard', heading: /dashboard|welcome|good (morning|afternoon|evening)/i },
  { path: '/generator', label: 'AI Code Generator', heading: 'AI Code Generator' },
  { path: '/converter', label: 'Code Converter', heading: 'Code Converter' },
  { path: '/studio', label: 'Algorithm Studio', heading: 'Algorithm Studio' },
  { path: '/explainer', label: 'Code Explainer', heading: 'Code Explainer' },
  { path: '/compiler', label: 'Compiler & Debugger', heading: 'Compiler & Debugger' },
  { path: '/repos', label: 'Repository Analyzer', heading: 'Repository Analyzer' },
  { path: '/learning', label: 'Learning Hub', heading: 'Learning Hub' },
  { path: '/workspace', label: 'My Workspace', heading: 'My Workspace' },
  { path: '/history', label: 'History', heading: 'History' },
  { path: '/settings', label: 'Settings', heading: 'Settings' },
] as const;
