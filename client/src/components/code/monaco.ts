/**
 * Monaco is bundled locally (no CDN) so the editor works fully offline.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// Keep JavaScript squiggles syntactic only — Node globals like require() are valid in CodePilot.
const ts = (monaco.languages as any).typescript;
if (ts?.javascriptDefaults) {
  ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  ts.javascriptDefaults.setCompilerOptions({ allowNonTsExtensions: true, target: 99, checkJs: false });
}

monaco.editor.defineTheme('codepilot-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '5f697c', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'b4a9ff' },
    { token: 'string', foreground: '7ee2c4' },
    { token: 'number', foreground: 'f3b65d' },
    { token: 'type', foreground: '6cb6ff' },
    { token: 'identifier', foreground: 'e6e9f2' },
    { token: 'delimiter', foreground: '929bad' },
  ],
  colors: {
    'editor.background': '#0e1219',
    'editor.foreground': '#e6e9f2',
    'editorLineNumber.foreground': '#3b4456',
    'editorLineNumber.activeForeground': '#929bad',
    'editor.lineHighlightBackground': '#151b2680',
    'editor.selectionBackground': '#8b7cff40',
    'editor.inactiveSelectionBackground': '#8b7cff22',
    'editorCursor.foreground': '#8b7cff',
    'editorIndentGuide.background1': '#1d2431',
    'editorWidget.background': '#151b26',
    'editorWidget.border': '#252d3a',
    'editorGutter.background': '#0e1219',
    'scrollbarSlider.background': '#252d3a80',
    'diffEditor.insertedTextBackground': '#35c9a522',
    'diffEditor.removedTextBackground': '#f7768e22',
  },
});

loader.config({ monaco });

export { monaco };
(window as any).monaco = monaco; // used by end-to-end tests to set editor content
