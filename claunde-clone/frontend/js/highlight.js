/* ============================================================
   Highlight — realce de sintaxe mínimo e offline.
   Varre o código com expressões "sticky": em cada posição testa
   as regras da linguagem em ordem; o que não casa vira texto puro.
   ============================================================ */
const Highlight = (() => {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

  const rule = (kind, source, flags = '') => ({ kind, re: new RegExp(source, flags + 'y') });
  const words = (list) => `\\b(?:${list.join('|')})\\b`;

  const NUMBER = String.raw`(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)[a-zA-Z_]*`;
  const OPERATOR = String.raw`[+\-*/%=<>!&|^~?:@]+`;
  const FUNC = String.raw`[A-Za-z_$][\w$]*(?=\s*\()`;

  const JS_KW = ['abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for',
    'from', 'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new',
    'of', 'private', 'protected', 'public', 'readonly', 'return', 'satisfies', 'set', 'static', 'super',
    'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var', 'void', 'while', 'with', 'yield'];
  const JS_LIT = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'];
  const JS_BUILTIN = ['Array', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number', 'Object',
    'Promise', 'Proxy', 'RegExp', 'Set', 'String', 'Symbol', 'WeakMap', 'console', 'document', 'fetch',
    'globalThis', 'localStorage', 'navigator', 'process', 'require', 'module', 'exports', 'window'];

  const PY_KW = ['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
    'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'match',
    'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'case'];
  const PY_LIT = ['True', 'False', 'None', 'self', 'cls'];
  const PY_BUILTIN = ['abs', 'all', 'any', 'bool', 'bytes', 'dict', 'enumerate', 'filter', 'float', 'format',
    'frozenset', 'getattr', 'hasattr', 'int', 'isinstance', 'iter', 'len', 'list', 'map', 'max', 'min',
    'next', 'open', 'print', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'sorted', 'str',
    'sum', 'super', 'tuple', 'type', 'zip', 'Exception', 'ValueError', 'TypeError', 'KeyError'];

  const SQL_KW = ['ADD', 'ALTER', 'AND', 'AS', 'ASC', 'BETWEEN', 'BY', 'CASE', 'CHECK', 'COLUMN', 'CONSTRAINT',
    'CREATE', 'DATABASE', 'DEFAULT', 'DELETE', 'DESC', 'DISTINCT', 'DROP', 'ELSE', 'END', 'EXISTS', 'FOREIGN',
    'FROM', 'FULL', 'GROUP', 'HAVING', 'IN', 'INDEX', 'INNER', 'INSERT', 'INTO', 'IS', 'JOIN', 'KEY', 'LEFT',
    'LIKE', 'LIMIT', 'NOT', 'NULL', 'OFFSET', 'ON', 'OR', 'ORDER', 'OUTER', 'PRIMARY', 'REFERENCES', 'RIGHT',
    'SELECT', 'SET', 'TABLE', 'THEN', 'TRUNCATE', 'UNION', 'UNIQUE', 'UPDATE', 'VALUES', 'VIEW', 'WHEN',
    'WHERE', 'WITH', 'INTEGER', 'TEXT', 'REAL', 'BLOB', 'VARCHAR', 'BOOLEAN', 'TIMESTAMP'];

  const SH_KW = ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
    'function', 'in', 'return', 'break', 'continue', 'local', 'export', 'source', 'alias', 'set', 'unset'];
  const SH_CMD = ['apt', 'awk', 'cat', 'cd', 'chmod', 'chown', 'cp', 'curl', 'cut', 'docker', 'echo', 'find',
    'git', 'grep', 'head', 'kill', 'ls', 'make', 'mkdir', 'mv', 'node', 'npm', 'ollama', 'pip', 'ps',
    'python', 'python3', 'rm', 'sed', 'sleep', 'sort', 'sudo', 'tail', 'tar', 'touch', 'uname', 'uvicorn',
    'wc', 'wget', 'which', 'xargs', 'yarn'];

  const C_KW = ['auto', 'bool', 'break', 'case', 'char', 'class', 'const', 'constexpr', 'continue', 'default',
    'delete', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long',
    'namespace', 'new', 'nullptr', 'operator', 'private', 'protected', 'public', 'return', 'short', 'signed',
    'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'try', 'typedef', 'union',
    'unsigned', 'using', 'virtual', 'void', 'volatile', 'while', 'catch', 'include', 'define'];

  const GO_KW = ['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
    'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select',
    'struct', 'switch', 'type', 'var', 'nil', 'true', 'false', 'string', 'int', 'int64', 'float64', 'bool',
    'byte', 'rune', 'error', 'make', 'len', 'cap', 'append', 'panic', 'recover'];

  const RS_KW = ['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
    'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub',
    'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use',
    'where', 'while', 'String', 'Vec', 'Option', 'Result', 'Some', 'None', 'Ok', 'Err', 'i32', 'u32', 'u8',
    'usize', 'f64', 'bool', 'str'];

  const JAVA_KW = ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
    'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for',
    'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package',
    'private', 'protected', 'public', 'return', 'short', 'static', 'super', 'switch', 'synchronized', 'this',
    'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'var', 'record', 'true', 'false',
    'null', 'String', 'System'];

  const cLike = (keywords) => [
    rule('comment', String.raw`//.*|/\*[\s\S]*?\*/`),
    rule('string', String.raw`"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'`),
    rule('number', NUMBER),
    rule('keyword', words(keywords)),
    rule('function', FUNC),
    rule('operator', OPERATOR),
  ];

  // Crase dentro de String.raw não é possível: monta-se o padrão por partes.
  const JS_STRING = [
    '`(?:\\\\[\\s\\S]|[^`\\\\])*`',
    String.raw`"(?:\\[\s\S]|[^"\\\n])*"`,
    String.raw`'(?:\\[\s\S]|[^'\\\n])*'`,
  ].join('|');

  const LANGS = {
    javascript: [
      rule('comment', String.raw`//.*|/\*[\s\S]*?\*/`),
      rule('string', JS_STRING),
      rule('number', NUMBER),
      rule('keyword', words(JS_KW)),
      rule('builtin', words(JS_LIT.concat(JS_BUILTIN))),
      rule('function', FUNC),
      rule('operator', OPERATOR),
    ],
    python: [
      rule('comment', String.raw`#.*`),
      rule('string', String.raw`[fFrRbBuU]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\\n])*"|'(?:\\[\s\S]|[^'\\\n])*')`),
      rule('property', String.raw`@[A-Za-z_][\w.]*`),
      rule('number', NUMBER),
      rule('keyword', words(PY_KW)),
      rule('builtin', words(PY_LIT.concat(PY_BUILTIN))),
      rule('function', FUNC),
      rule('operator', OPERATOR),
    ],
    json: [
      rule('property', String.raw`"(?:\\.|[^"\\])*"(?=\s*:)`),
      rule('string', String.raw`"(?:\\.|[^"\\])*"`),
      rule('number', String.raw`-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`),
      rule('keyword', words(['true', 'false', 'null'])),
    ],
    bash: [
      rule('comment', String.raw`#.*`),
      rule('string', String.raw`"(?:\\[\s\S]|[^"\\])*"|'[^']*'`),
      rule('builtin', String.raw`\$\{[^}]*\}|\$[A-Za-z_][\w]*|\$[@#?*!$0-9]`),
      rule('keyword', words(SH_KW)),
      rule('function', words(SH_CMD)),
      rule('attr', String.raw`(?<=\s)--?[A-Za-z][\w-]*`),
      rule('number', String.raw`\b\d+\b`),
      rule('operator', String.raw`[|&;<>()]+`),
    ],
    html: [
      rule('comment', String.raw`<!--[\s\S]*?-->|<!DOCTYPE[^>]*>`, 'i'),
      rule('tag', String.raw`</?[A-Za-z][\w:-]*|/?>`),
      rule('attr', String.raw`[A-Za-z_@:][\w:.-]*(?=\s*=)`),
      rule('string', String.raw`"(?:[^"]*)"|'(?:[^']*)'`),
      rule('builtin', String.raw`&[a-zA-Z]+;|&#\d+;`),
    ],
    css: [
      rule('comment', String.raw`/\*[\s\S]*?\*/`),
      rule('keyword', String.raw`@[a-zA-Z-]+`),
      rule('string', String.raw`"(?:[^"]*)"|'(?:[^']*)'`),
      rule('property', String.raw`[-a-zA-Z]+(?=\s*:)`),
      rule('builtin', String.raw`#[0-9a-fA-F]{3,8}\b`),
      rule('number', String.raw`-?\d*\.?\d+(?:px|em|rem|vh|vw|%|s|ms|deg|fr|ch|pt)?`),
      rule('tag', String.raw`[.#][-\w]+|::?[-\w]+`),
      rule('function', FUNC),
    ],
    sql: [
      rule('comment', String.raw`--.*|/\*[\s\S]*?\*/`),
      rule('string', String.raw`'(?:''|[^'])*'`),
      rule('property', String.raw`"[^"]*"`),
      rule('keyword', words(SQL_KW), 'i'),
      rule('number', NUMBER),
      rule('function', FUNC),
      rule('operator', OPERATOR),
    ],
    yaml: [
      rule('comment', String.raw`#.*`),
      rule('property', String.raw`^\s*-?\s*[\w.-]+(?=\s*:)`, 'm'),
      rule('string', String.raw`"(?:\\.|[^"\\])*"|'[^']*'`),
      rule('keyword', words(['true', 'false', 'null', 'yes', 'no', 'on', 'off'])),
      rule('number', NUMBER),
      rule('operator', String.raw`[-:>|]+`),
    ],
    dockerfile: [
      rule('comment', String.raw`#.*`),
      rule('keyword', words(['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT',
        'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'HEALTHCHECK', 'SHELL', 'AS']), 'i'),
      rule('string', String.raw`"(?:\\.|[^"\\])*"|'[^']*'`),
      rule('builtin', String.raw`\$\{[^}]*\}|\$\w+`),
      rule('number', NUMBER),
    ],
    go: cLike(GO_KW),
    rust: cLike(RS_KW),
    java: cLike(JAVA_KW),
    c: cLike(C_KW),
    php: cLike(['echo', 'function', 'class', 'public', 'private', 'protected', 'return', 'if', 'else',
      'foreach', 'as', 'new', 'use', 'namespace', 'null', 'true', 'false', 'array']),
    ruby: [
      rule('comment', String.raw`#.*`),
      rule('string', String.raw`"(?:\\.|[^"\\])*"|'[^']*'|:\w+`),
      rule('keyword', words(['def', 'end', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'while',
        'do', 'return', 'yield', 'require', 'attr_accessor', 'nil', 'true', 'false', 'self', 'puts'])),
      rule('builtin', String.raw`@@?\w+`),
      rule('number', NUMBER),
      rule('function', FUNC),
      rule('operator', OPERATOR),
    ],
  };

  const ALIASES = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
    ts: 'javascript', tsx: 'javascript', typescript: 'javascript',
    py: 'python', python3: 'python',
    sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash', bat: 'bash',
    htm: 'html', xml: 'html', svg: 'html', vue: 'html',
    scss: 'css', sass: 'css', less: 'css',
    yml: 'yaml',
    postgres: 'sql', postgresql: 'sql', mysql: 'sql', sqlite: 'sql',
    'c++': 'c', cpp: 'c', cc: 'c', h: 'c', hpp: 'c', csharp: 'java', cs: 'java', kotlin: 'java',
    golang: 'go', rs: 'rust', rb: 'ruby',
    docker: 'dockerfile',
    json5: 'json', jsonc: 'json',
  };

  /** Adivinha a linguagem quando o bloco não declara nenhuma. */
  function guess(code) {
    const head = code.slice(0, 400);
    if (/^\s*[{[][\s\S]*[}\]]\s*$/.test(code.trim()) && /"[^"]*"\s*:/.test(head)) return 'json';
    if (/^\s*(?:def |class |import |from .+ import|print\()/m.test(head)) return 'python';
    if (/(?:^|\n)\s*(?:const|let|var|function|=>|export |import .* from)/.test(head)) return 'javascript';
    if (/^\s*<[a-zA-Z!]/.test(head)) return 'html';
    if (/^\s*(?:\$ |sudo |npm |pip |docker |git |cd |ls |curl )/m.test(head)) return 'bash';
    if (/\b(?:SELECT|INSERT INTO|CREATE TABLE|UPDATE)\b/i.test(head)) return 'sql';
    if (/^[.#@]?[\w-]+\s*\{[^}]*:[^}]*;/m.test(head)) return 'css';
    return null;
  }

  function highlight(code, lang) {
    const key = ALIASES[(lang || '').toLowerCase()] || (lang || '').toLowerCase();
    const rules = LANGS[key] || LANGS[guess(code)] || null;
    if (!rules) return esc(code);

    const out = [];
    let plain = '';
    let pos = 0;

    while (pos < code.length) {
      let matched = false;

      for (const { kind, re } of rules) {
        re.lastIndex = pos;
        const found = re.exec(code);
        if (found && found[0].length) {
          if (plain) { out.push(esc(plain)); plain = ''; }
          out.push(`<span class="tok-${kind}">${esc(found[0])}</span>`);
          pos = re.lastIndex;
          matched = true;
          break;
        }
      }

      if (!matched) {
        // Consome o identificador inteiro para não reprocessar seus pedaços.
        const word = /[A-Za-z_$][\w$]*/y;
        word.lastIndex = pos;
        const id = word.exec(code);
        if (id) { plain += id[0]; pos = word.lastIndex; }
        else { plain += code[pos]; pos++; }
      }
    }

    if (plain) out.push(esc(plain));
    return out.join('');
  }

  return { highlight, guess, languages: Object.keys(LANGS) };
})();
