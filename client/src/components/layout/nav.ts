import { BookOpen, Bug, FolderGit2, Code2, FolderKanban, GitBranch, History, LayoutDashboard, MessageSquareCode, Settings, Shuffle, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
  keywords: string;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview of your programming activity', keywords: 'home overview stats' },
  { to: '/generator', label: 'AI Code Generator', icon: Code2, description: 'Describe a problem and generate code', keywords: 'generate write create program' },
  { to: '/converter', label: 'Code Converter', icon: Shuffle, description: 'Translate code between languages', keywords: 'convert translate port' },
  { to: '/studio', label: 'Algorithm Studio', icon: GitBranch, description: 'Algorithms, pseudocode, flowcharts and visualisations', keywords: 'algorithm flowchart pseudocode visualize dry run sort search graph' },
  { to: '/explainer', label: 'Code Explainer', icon: MessageSquareCode, description: 'Understand code line by line', keywords: 'explain understand analyse' },
  { to: '/compiler', label: 'Compiler & Debugger', icon: Bug, description: 'Run, test and debug programs locally', keywords: 'run compile execute debug test' },
  { to: '/repos', label: 'Repository Analyzer', icon: FolderGit2, description: 'Review whole repositories: bugs, security, complexity, dependencies, Git', keywords: 'repository repo analyzer code review security scan bugs dependencies technical debt git report' },
  { to: '/learning', label: 'Learning Hub', icon: BookOpen, description: 'Viva questions, MCQs and practice problems', keywords: 'learn quiz mcq viva practice dsa' },
  { to: '/workspace', label: 'My Workspace', icon: FolderKanban, description: 'Projects and saved code files', keywords: 'projects files workspace saved' },
  { to: '/history', label: 'History', icon: History, description: 'Every generation, conversion and run', keywords: 'history activity log' },
  { to: '/settings', label: 'Settings', icon: Settings, description: 'Editor, AI provider and execution settings', keywords: 'settings preferences ollama theme' },
];
