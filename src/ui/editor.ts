/**
 * CodeMirror 6 のエディタ。エラーを行番号付きの診断として表示する。
 */
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { ScriptErrorInfo } from '../sim/script';

export interface CodeEditor {
  view: EditorView;
  getCode(): string;
  setCode(code: string): void;
  showErrors(errors: ScriptErrorInfo[]): void;
}

export function createEditor(
  parent: HTMLElement,
  initial: string,
  handlers: { onApply: () => void; onChange: (code: string) => void },
): CodeEditor {
  const view = new EditorView({
    parent,
    doc: initial,
    extensions: [
      basicSetup,
      python(),
      oneDark,
      lintGutter(),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            handlers.onApply();
            return true;
          },
        },
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) handlers.onChange(u.state.doc.toString());
      }),
      EditorView.theme({ '&': { height: '100%' } }),
    ],
  });

  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode: (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }),
    showErrors: (errors) => {
      const doc = view.state.doc;
      const diagnostics: Diagnostic[] = errors.map((e) => {
        const line = doc.line(Math.min(Math.max(1, e.line), doc.lines));
        return { from: line.from, to: line.to, severity: 'error', message: e.message };
      });
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },
  };
}
