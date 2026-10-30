/**
 * Python 風言語の構文解析器。トークン列から AST を作る。
 */
import { KEYWORDS, ScriptError, tokenize, type Token } from './lexer';

export type Expr =
  | { kind: 'num'; value: number; line: number }
  | { kind: 'str'; value: string; line: number }
  | { kind: 'const'; value: boolean | null; line: number }
  | { kind: 'name'; name: string; line: number }
  | { kind: 'list'; items: Expr[]; line: number }
  | { kind: 'attr'; obj: Expr; name: string; line: number }
  | { kind: 'index'; obj: Expr; index: Expr; line: number }
  | { kind: 'call'; func: Expr; args: Expr[]; line: number }
  | { kind: 'unary'; op: '-' | '+' | 'not'; operand: Expr; line: number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; line: number }
  | { kind: 'bool'; op: 'and' | 'or'; left: Expr; right: Expr; line: number };

export type Target = Extract<Expr, { kind: 'name' | 'attr' | 'index' }>;

export type Stmt =
  | { kind: 'expr'; expr: Expr; line: number }
  | { kind: 'assign'; target: Target; op: string; value: Expr; line: number }
  | { kind: 'if'; cond: Expr; body: Stmt[]; orelse: Stmt[]; line: number }
  | { kind: 'while'; cond: Expr; body: Stmt[]; line: number }
  | { kind: 'for'; name: string; iter: Expr; body: Stmt[]; line: number }
  | { kind: 'def'; name: string; params: string[]; body: Stmt[]; line: number }
  | { kind: 'return'; value: Expr | null; line: number }
  | { kind: 'pass' | 'break' | 'continue'; line: number };

export interface ParseOptions {
  /** for / while / break / continue を許可するか */
  allowLoops: boolean;
}

const LOOP_LOCKED = 'はまだ使えません（ショップで「ループ構文」を解放してください）';

export function parse(source: string, options: ParseOptions): Stmt[] {
  return new Parser(tokenize(source), options).parseProgram();
}

class Parser {
  private pos = 0;
  private loopDepth = 0;
  private funcDepth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly options: ParseOptions,
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t.type === 'op' && t.value === value;
  }

  private isKeyword(value: string): boolean {
    const t = this.peek();
    return t.type === 'name' && t.value === value;
  }

  private expectOp(value: string): Token {
    if (!this.isOp(value)) {
      throw new ScriptError(`'${value}' が必要です（${describe(this.peek())} があります）`, this.peek().line);
    }
    return this.next();
  }

  private expectName(): string {
    const t = this.peek();
    if (t.type !== 'name' || isReserved(t.value)) {
      throw new ScriptError(`名前が必要です（${describe(t)} があります）`, t.line);
    }
    this.next();
    return t.value;
  }

  private expectNewline(): void {
    const t = this.peek();
    if (t.type === 'newline') {
      this.next();
      return;
    }
    if (t.type === 'eof' || t.type === 'dedent') return;
    throw new ScriptError(`文の終わりに余分なものがあります: ${describe(t)}`, t.line);
  }

  parseProgram(): Stmt[] {
    const body: Stmt[] = [];
    while (this.peek().type !== 'eof') {
      if (this.peek().type === 'newline') {
        this.next();
        continue;
      }
      if (this.peek().type === 'indent') {
        throw new ScriptError('不要なインデントがあります', this.peek().line);
      }
      body.push(this.parseStatement());
    }
    return body;
  }

  private parseBlock(): Stmt[] {
    this.expectOp(':');
    // 1行で書く形式（例：if x: pass）
    if (this.peek().type !== 'newline') {
      const stmt = this.parseSimple();
      this.expectNewline();
      return [stmt];
    }
    this.next();
    if (this.peek().type !== 'indent') {
      throw new ScriptError('ブロックの中身はインデントして書いてください', this.peek().line);
    }
    this.next();
    const body: Stmt[] = [];
    while (this.peek().type !== 'dedent' && this.peek().type !== 'eof') {
      if (this.peek().type === 'newline') {
        this.next();
        continue;
      }
      body.push(this.parseStatement());
    }
    if (this.peek().type === 'dedent') this.next();
    return body;
  }

  private parseStatement(): Stmt {
    const t = this.peek();
    if (t.type === 'name') {
      switch (t.value) {
        case 'def':
          return this.parseDef();
        case 'if':
          return this.parseIf();
        case 'while':
          return this.parseWhile();
        case 'for':
          return this.parseFor();
        case 'elif':
        case 'else':
          throw new ScriptError(`'${t.value}' に対応する if がありません`, t.line);
      }
    }
    const stmt = this.parseSimple();
    this.expectNewline();
    return stmt;
  }

  private parseDef(): Stmt {
    const line = this.next().line;
    if (this.funcDepth > 0) throw new ScriptError('関数の中で関数は定義できません', line);
    const name = this.expectName();
    this.expectOp('(');
    const params: string[] = [];
    while (!this.isOp(')')) {
      const p = this.expectName();
      if (params.includes(p)) throw new ScriptError(`引数名 '${p}' が重複しています`, line);
      params.push(p);
      if (!this.isOp(')')) this.expectOp(',');
    }
    this.expectOp(')');
    this.funcDepth++;
    const savedLoop = this.loopDepth;
    this.loopDepth = 0;
    const body = this.parseBlock();
    this.loopDepth = savedLoop;
    this.funcDepth--;
    return { kind: 'def', name, params, body, line };
  }

  private parseIf(): Stmt {
    const line = this.next().line;
    const cond = this.parseExpr();
    const body = this.parseBlock();
    let orelse: Stmt[] = [];
    if (this.isKeyword('elif')) {
      orelse = [this.parseIf()];
    } else if (this.isKeyword('else')) {
      this.next();
      orelse = this.parseBlock();
    }
    return { kind: 'if', cond, body, orelse, line };
  }

  private requireLoops(word: string, line: number): void {
    if (!this.options.allowLoops) throw new ScriptError(`'${word}' ${LOOP_LOCKED}`, line);
  }

  private parseWhile(): Stmt {
    const line = this.next().line;
    this.requireLoops('while', line);
    const cond = this.parseExpr();
    this.loopDepth++;
    const body = this.parseBlock();
    this.loopDepth--;
    return { kind: 'while', cond, body, line };
  }

  private parseFor(): Stmt {
    const line = this.next().line;
    this.requireLoops('for', line);
    const name = this.expectName();
    if (!this.isKeyword('in')) throw new ScriptError("for 文には 'in' が必要です", line);
    this.next();
    const iter = this.parseExpr();
    this.loopDepth++;
    const body = this.parseBlock();
    this.loopDepth--;
    return { kind: 'for', name, iter, body, line };
  }

  private parseSimple(): Stmt {
    const t = this.peek();
    if (t.type === 'name') {
      switch (t.value) {
        case 'pass':
          this.next();
          return { kind: 'pass', line: t.line };
        case 'break':
        case 'continue':
          this.next();
          this.requireLoops(t.value, t.line);
          if (this.loopDepth === 0) throw new ScriptError(`'${t.value}' はループの中でしか使えません`, t.line);
          return { kind: t.value, line: t.line };
        case 'return': {
          this.next();
          if (this.funcDepth === 0) throw new ScriptError("'return' は関数の中でしか使えません", t.line);
          const pt = this.peek();
          const value = pt.type === 'newline' || pt.type === 'eof' || pt.type === 'dedent' ? null : this.parseExpr();
          return { kind: 'return', value, line: t.line };
        }
        case 'def':
        case 'if':
        case 'while':
        case 'for':
          throw new ScriptError(`'${t.value}' はここでは書けません`, t.line);
      }
    }
    const expr = this.parseExpr();
    const opTok = this.peek();
    if (opTok.type === 'op' && ['=', '+=', '-=', '*=', '/='].includes(opTok.value)) {
      this.next();
      if (expr.kind !== 'name' && expr.kind !== 'attr' && expr.kind !== 'index') {
        throw new ScriptError('この左辺には代入できません', opTok.line);
      }
      const value = this.parseExpr();
      return { kind: 'assign', target: expr, op: opTok.value, value, line: t.line };
    }
    return { kind: 'expr', expr, line: t.line };
  }

  // ---- 式（優先順位の低い順）----

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.isKeyword('or')) {
      const line = this.next().line;
      left = { kind: 'bool', op: 'or', left, right: this.parseAnd(), line };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.isKeyword('and')) {
      const line = this.next().line;
      left = { kind: 'bool', op: 'and', left, right: this.parseNot(), line };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.isKeyword('not')) {
      const line = this.next().line;
      return { kind: 'unary', op: 'not', operand: this.parseNot(), line };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parseAdditive();
    const t = this.peek();
    let op: string | null = null;
    if (t.type === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(t.value)) {
      op = t.value;
      this.next();
    } else if (this.isKeyword('in')) {
      op = 'in';
      this.next();
    } else if (this.isKeyword('not') && this.peek(1).type === 'name' && this.peek(1).value === 'in') {
      op = 'not in';
      this.next();
      this.next();
    }
    if (op === null) return left;
    const right = this.parseAdditive();
    const nt = this.peek();
    if (nt.type === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(nt.value)) {
      throw new ScriptError('比較の連結（a < b < c）は使えません。and でつないでください', nt.line);
    }
    return { kind: 'binary', op, left, right, line: t.line };
  }

  private parseAdditive(): Expr {
    let left = this.parseTerm();
    while (this.isOp('+') || this.isOp('-')) {
      const t = this.next();
      left = { kind: 'binary', op: t.value, left, right: this.parseTerm(), line: t.line };
    }
    return left;
  }

  private parseTerm(): Expr {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('//') || this.isOp('%')) {
      const t = this.next();
      left = { kind: 'binary', op: t.value, left, right: this.parseUnary(), line: t.line };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.isOp('-') || this.isOp('+')) {
      const t = this.next();
      return { kind: 'unary', op: t.value as '-' | '+', operand: this.parseUnary(), line: t.line };
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    const base = this.parsePostfix();
    if (this.isOp('**')) {
      const t = this.next();
      return { kind: 'binary', op: '**', left: base, right: this.parseUnary(), line: t.line };
    }
    return base;
  }

  private parsePostfix(): Expr {
    let expr = this.parseAtom();
    for (;;) {
      if (this.isOp('.')) {
        const line = this.next().line;
        const t = this.peek();
        if (t.type !== 'name') throw new ScriptError("'.' の後には名前が必要です", line);
        this.next();
        expr = { kind: 'attr', obj: expr, name: t.value, line };
      } else if (this.isOp('(')) {
        const line = this.next().line;
        const args: Expr[] = [];
        while (!this.isOp(')')) {
          args.push(this.parseExpr());
          if (!this.isOp(')')) this.expectOp(',');
        }
        this.expectOp(')');
        expr = { kind: 'call', func: expr, args, line };
      } else if (this.isOp('[')) {
        const line = this.next().line;
        const index = this.parseExpr();
        this.expectOp(']');
        expr = { kind: 'index', obj: expr, index, line };
      } else {
        return expr;
      }
    }
  }

  private parseAtom(): Expr {
    const t = this.next();
    switch (t.type) {
      case 'number':
        return { kind: 'num', value: Number(t.value), line: t.line };
      case 'string':
        return { kind: 'str', value: t.value, line: t.line };
      case 'name':
        if (t.value === 'True') return { kind: 'const', value: true, line: t.line };
        if (t.value === 'False') return { kind: 'const', value: false, line: t.line };
        if (t.value === 'None') return { kind: 'const', value: null, line: t.line };
        if (isReserved(t.value)) throw new ScriptError(`'${t.value}' はここでは使えません`, t.line);
        return { kind: 'name', name: t.value, line: t.line };
      case 'op':
        if (t.value === '(') {
          const e = this.parseExpr();
          this.expectOp(')');
          return e;
        }
        if (t.value === '[') {
          const items: Expr[] = [];
          while (!this.isOp(']')) {
            items.push(this.parseExpr());
            if (!this.isOp(']')) this.expectOp(',');
          }
          this.expectOp(']');
          return { kind: 'list', items, line: t.line };
        }
        break;
    }
    throw new ScriptError(`式が必要です（${describe(t)} があります）`, t.line);
  }
}

function isReserved(name: string): boolean {
  return KEYWORDS.has(name);
}

function describe(t: Token): string {
  switch (t.type) {
    case 'newline':
      return '行末';
    case 'eof':
      return 'コードの終わり';
    case 'indent':
      return 'インデント';
    case 'dedent':
      return 'インデントの終わり';
    default:
      return `'${t.value}'`;
  }
}
