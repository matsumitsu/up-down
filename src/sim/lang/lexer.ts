/**
 * Python 風言語の字句解析器。
 * インデントを INDENT / DEDENT トークンに変換する。
 */

export class ScriptError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(message);
    this.name = 'ScriptError';
  }
}

export type TokenType = 'name' | 'number' | 'string' | 'op' | 'newline' | 'indent' | 'dedent' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
}

export const KEYWORDS = new Set([
  'def',
  'if',
  'elif',
  'else',
  'while',
  'for',
  'in',
  'return',
  'pass',
  'break',
  'continue',
  'and',
  'or',
  'not',
  'True',
  'False',
  'None',
]);

// 長いものから順に照合する
const OPERATORS = [
  '**',
  '//',
  '==',
  '!=',
  '<=',
  '>=',
  '+=',
  '-=',
  '*=',
  '/=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '(',
  ')',
  '[',
  ']',
  ',',
  ':',
  '.',
];

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const indentStack = [0];
  // 括弧の中では改行・インデントを無視する
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const text = lines[i];
    let pos = 0;

    if (depth === 0) {
      // 空行・コメント行はインデント計算に含めない
      const stripped = text.trim();
      if (stripped === '' || stripped.startsWith('#')) continue;
      let indent = 0;
      while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) {
        indent += text[pos] === '\t' ? 4 : 1;
        pos++;
      }
      const top = indentStack[indentStack.length - 1];
      if (indent > top) {
        indentStack.push(indent);
        tokens.push({ type: 'indent', value: '', line: lineNo });
      } else {
        while (indent < indentStack[indentStack.length - 1]) {
          indentStack.pop();
          tokens.push({ type: 'dedent', value: '', line: lineNo });
        }
        if (indent !== indentStack[indentStack.length - 1]) {
          throw new ScriptError('インデントの深さが前の行と合っていません', lineNo);
        }
      }
    }

    while (pos < text.length) {
      const ch = text[pos];
      if (ch === ' ' || ch === '\t') {
        pos++;
        continue;
      }
      if (ch === '#') break;

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[pos + 1] ?? ''))) {
        const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(text.slice(pos));
        const value = m ? m[0] : ch;
        tokens.push({ type: 'number', value, line: lineNo });
        pos += value.length;
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(pos))!;
        tokens.push({ type: 'name', value: m[0], line: lineNo });
        pos += m[0].length;
        continue;
      }

      if (ch === '"' || ch === "'") {
        let j = pos + 1;
        let value = '';
        while (j < text.length && text[j] !== ch) {
          if (text[j] === '\\' && j + 1 < text.length) {
            const next = text[j + 1];
            value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            j += 2;
          } else {
            value += text[j];
            j++;
          }
        }
        if (j >= text.length) throw new ScriptError('文字列が閉じられていません', lineNo);
        tokens.push({ type: 'string', value, line: lineNo });
        pos = j + 1;
        continue;
      }

      const op = OPERATORS.find((o) => text.startsWith(o, pos));
      if (!op) throw new ScriptError(`使えない文字です: '${ch}'`, lineNo);
      if (op === '(' || op === '[') depth++;
      if (op === ')' || op === ']') depth = Math.max(0, depth - 1);
      tokens.push({ type: 'op', value: op, line: lineNo });
      pos += op.length;
    }

    if (depth === 0) tokens.push({ type: 'newline', value: '', line: lineNo });
  }

  const lastLine = Math.max(1, lines.length);
  if (depth > 0) throw new ScriptError('括弧が閉じられていません', lastLine);
  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ type: 'dedent', value: '', line: lastLine });
  }
  tokens.push({ type: 'eof', value: '', line: lastLine });
  return tokens;
}
