import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { useSettings } from '@/store';
import { monacoLang, cn } from '@/lib/utils';
import type { Lang } from '@/lib/types';
import { Skeleton } from '../ui/primitives';

const MonacoEditor = lazy(async () => {
  await import('./monaco');
  const m = await import('@monaco-editor/react');
  return { default: m.default };
});
const MonacoDiff = lazy(async () => {
  await import('./monaco');
  const m = await import('@monaco-editor/react');
  return { default: m.DiffEditor };
});

export interface Marker {
  line: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

function useEditorOptions(readOnly?: boolean, compact?: boolean): editor.IStandaloneEditorConstructionOptions {
  const s = useSettings((x) => x.settings);
  return useMemo(
    () => ({
      fontSize: s.editorFontSize,
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontLigatures: false,
      tabSize: s.tabSize,
      insertSpaces: true,
      wordWrap: s.wordWrap ? 'on' : 'off',
      minimap: { enabled: s.minimap && !compact },
      readOnly,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderLineHighlight: readOnly ? 'none' : 'line',
      padding: { top: 12, bottom: 12 },
      automaticLayout: true,
      lineNumbersMinChars: 3,
      glyphMargin: false,
      folding: !compact,
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      overviewRulerBorder: false,
      fixedOverflowWidgets: true,
      stickyScroll: { enabled: false },
    }),
    [s.editorFontSize, s.tabSize, s.wordWrap, s.minimap, readOnly, compact],
  );
}

function themeName(editorTheme: string, appTheme: string) {
  if (appTheme === 'light' && editorTheme === 'codepilot-dark') return 'vs';
  return editorTheme;
}

export function CodeEditor({
  value,
  onChange,
  language,
  readOnly,
  height = '100%',
  className,
  markers,
  highlightLine,
  compact,
  ariaLabel = 'Code editor',
  onRun,
}: {
  value: string;
  onChange?: (v: string) => void;
  language: Lang | 'plaintext' | 'markdown';
  readOnly?: boolean;
  height?: string | number;
  className?: string;
  markers?: Marker[];
  highlightLine?: number | null;
  compact?: boolean;
  ariaLabel?: string;
  onRun?: () => void;
}) {
  const options = useEditorOptions(readOnly, compact);
  const s = useSettings((x) => x.settings);
  const edRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const decoRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const runRef = useRef(onRun);
  runRef.current = onRun;
  // markers / highlight effects must run again once the lazily-loaded editor has mounted
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const m = monacoRef.current;
    const ed = edRef.current;
    if (!m || !ed) return;
    const model = ed.getModel();
    if (!model) return;
    m.editor.setModelMarkers(
      model,
      'codepilot',
      (markers ?? []).filter((x) => x.line > 0 && x.line <= model.getLineCount()).map((x) => ({
        startLineNumber: x.line,
        endLineNumber: x.line,
        startColumn: 1,
        endColumn: model.getLineMaxColumn(x.line),
        message: x.message,
        severity: x.severity === 'error' ? m.MarkerSeverity.Error : x.severity === 'warning' ? m.MarkerSeverity.Warning : m.MarkerSeverity.Info,
      })),
    );
  }, [markers, value, mounted]);

  useEffect(() => {
    const ed = edRef.current;
    const m = monacoRef.current;
    if (!ed || !m) return;
    decoRef.current?.clear();
    if (highlightLine && highlightLine > 0) {
      decoRef.current = ed.createDecorationsCollection([{ range: new m.Range(highlightLine, 1, highlightLine, 1), options: { isWholeLine: true, className: 'cp-line-highlight' } }]);
      ed.revealLineInCenterIfOutsideViewport(highlightLine);
    }
  }, [highlightLine, mounted]);

  const lang = language === 'plaintext' || language === 'markdown' ? language : monacoLang(language);
  return (
    <div className={cn('relative h-full min-h-0 overflow-hidden', className)} aria-label={ariaLabel}>
      <Suspense fallback={<EditorSkeleton />}>
        <MonacoEditor
          height={height}
          language={lang}
          value={value}
          theme={themeName(s.editorTheme, s.theme)}
          options={options}
          loading={<EditorSkeleton />}
          onChange={(v) => onChange?.(v ?? '')}
          onMount={(ed, m) => {
            edRef.current = ed;
            monacoRef.current = m as unknown as typeof import('monaco-editor');
            ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => runRef.current?.());
            setMounted(true);
          }}
        />
      </Suspense>
    </div>
  );
}

export function DiffView({ original, modified, language, height = '100%' }: { original: string; modified: string; language: Lang; height?: string | number }) {
  const options = useEditorOptions(true, true);
  const s = useSettings((x) => x.settings);
  const diffRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  // @monaco-editor/react disposes the text models before the diff widget on unmount, which makes Monaco
  // throw "TextModel got disposed before DiffEditorWidget model got reset". Keep the models, detach them
  // from the widget first, then dispose them ourselves in the right order.
  useEffect(
    () => () => {
      const ed = diffRef.current;
      if (!ed) return;
      const models = ed.getModel();
      ed.setModel(null);
      models?.original.dispose();
      models?.modified.dispose();
    },
    [],
  );
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <Suspense fallback={<EditorSkeleton />}>
        <MonacoDiff
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          onMount={(ed) => {
            diffRef.current = ed;
          }}
          height={height}
          language={monacoLang(language)}
          original={original}
          modified={modified}
          theme={themeName(s.editorTheme, s.theme)}
          options={{ ...options, renderSideBySide: true, readOnly: true, originalEditable: false, renderOverviewRuler: false } as editor.IDiffEditorConstructionOptions}
        />
      </Suspense>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2.5 bg-[#0e1219] p-4">
      {[70, 45, 82, 60, 30, 75].map((w, i) => (
        <div key={i} style={{ width: `${w}%` }}>
          <Skeleton className="h-3.5" />
        </div>
      ))}
    </div>
  );
}
