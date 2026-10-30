/**
 * CodeMirror 6 のエディタ。エラーを行番号付きの診断として表示する。
 */
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { acceptCompletion, autocompletion } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { indentUnit } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { FeatureId } from '../data/balance';
import type { ScriptErrorInfo } from '../sim/script';
import { createCompletionSource } from './completions';

export interface CodeEditor {
  view: EditorView;
  getCode(): string;
  setCode(code: string): void;
  /** 内容を置き換える（取り消し履歴に残し、変わらない部分のカーソル位置は保つ） */
  replaceCode(code: string): void;
  showErrors(errors: ScriptErrorInfo[]): void;
}

export function createEditor(
  parent: HTMLElement,
  initial: string,
  handlers: { onApply: () => void; onChange: (code: string) => void; getFeatures: () => ReadonlySet<FeatureId> },
): CodeEditor {
  const view = new EditorView({
    parent,
    doc: initial,
    extensions: [
      // 標準キーマップの Mod-Enter（空行の挿入）より優先させる
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              handlers.onApply();
              return true;
            },
          },
          // 補完の候補が出ていれば Tab で確定。出ていなければ下のインデントに回す
          { key: 'Tab', run: acceptCompletion },
        ]),
      ),
      basicSetup,
      python(),
      indentUnit.of('    '),
      autocompletion({ override: [createCompletionSource(handlers.getFeatures)] }),
      oneDark,
      lintGutter(),
      keymap.of([indentWithTab]),
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
    replaceCode: (code) => {
      const old = view.state.doc.toString();
      let start = 0;
      while (start < old.length && start < code.length && old[start] === code[start]) start++;
      view.dispatch({ changes: { from: start, to: old.length, insert: code.slice(start) } });
    },
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
