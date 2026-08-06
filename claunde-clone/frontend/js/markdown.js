/* ============================================================
   Markdown — renderizador próprio, sem dependências externas.
   Suporta: títulos, listas aninhadas, citações, tabelas, regras,
   código (inline e em bloco), links, imagens, ênfase e riscado.
   Blocos de código não fechados continuam válidos (streaming).
   ============================================================ */
const Markdown = (() => {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

  /** Bloqueia esquemas perigosos em href/src. */
  function safeUrl(url) {
    const clean = url.trim().replace(/[\u0000-\u001f]/g, '');
    if (/^(javascript|data|vbscript):/i.test(clean.replace(/\s/g, ''))) return '#';
    return escapeHtml(clean);
  }

  // ------------------------------------------------------------------ inline
  function inline(src) {
    const codes = [];
    // 1. Protege o código inline antes de qualquer outra transformação.
    let out = String(src).replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code) => {
      codes.push(code.replace(/^ | $/g, ''));
      return `\u0000C${codes.length - 1}\u0000`;
    });

    out = escapeHtml(out);

    // 2. Imagens e links.
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (_, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy">`);
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, label, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    out = out.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?])/g,
      (_, pre, url) => `${pre}<a href="${safeUrl(url.startsWith('www.') ? 'http://' + url : url)}" target="_blank" rel="noopener noreferrer">${url}</a>`);

    // 3. Ênfase — negrito antes de itálico para não competir pelos asteriscos.
    out = out.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
    out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
    out = out.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');

    // 4. Devolve o código protegido, já escapado.
    return out.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  }

  // ------------------------------------------------------------------ blocos
  const RE = {
    fence:     /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/,
    heading:   /^ {0,3}(#{1,6})\s+(.*)$/,
    hr:        /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
    quote:     /^ {0,3}>\s?(.*)$/,
    ul:        /^(\s*)([-*+])\s+(.*)$/,
    ol:        /^(\s*)(\d{1,9})[.)]\s+(.*)$/,
    tableSep:  /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
  };

  const isBlockStart = (line) =>
    RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) ||
    RE.quote.test(line) || RE.ul.test(line) || RE.ol.test(line) || !line.trim();

  function render(text) {
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    return parseBlocks(lines);
  }

  function parseBlocks(lines) {
    const html = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      // --- bloco de código cercado
      const fence = line.match(RE.fence);
      if (fence) {
        const marker = fence[1][0];
        const lang = (fence[2] || '').toLowerCase();
        const body = [];
        i++;
        while (i < lines.length) {
          const close = lines[i].match(RE.fence);
          if (close && close[1][0] === marker && close[1].length >= fence[1].length) { i++; break; }
          body.push(lines[i]);
          i++;
        }
        html.push(codeBlock(body.join('\n'), lang));
        continue;
      }

      // --- título
      const heading = line.match(RE.heading);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
        i++;
        continue;
      }

      // --- régua horizontal
      if (RE.hr.test(line)) { html.push('<hr>'); i++; continue; }

      // --- citação
      if (RE.quote.test(line)) {
        const inner = [];
        while (i < lines.length && (RE.quote.test(lines[i]) || (lines[i].trim() && inner.length))) {
          const m = lines[i].match(RE.quote);
          inner.push(m ? m[1] : lines[i]);
          i++;
        }
        html.push(`<blockquote>${parseBlocks(inner)}</blockquote>`);
        continue;
      }

      // --- tabela
      if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        const consumed = table(lines, i);
        html.push(consumed.html);
        i = consumed.next;
        continue;
      }

      // --- listas
      if (RE.ul.test(line) || RE.ol.test(line)) {
        const consumed = list(lines, i);
        html.push(consumed.html);
        i = consumed.next;
        continue;
      }

      // --- parágrafo
      const para = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
        para.push(lines[i].trim());
        i++;
      }
      if (!para.length) { para.push(lines[i].trim()); i++; }
      html.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }

    return html.join('\n');
  }

  function codeBlock(code, lang) {
    const highlighted = (typeof Highlight !== 'undefined')
      ? Highlight.highlight(code, lang)
      : escapeHtml(code);
    const label = lang || 'texto';
    return `<div class="code-block" data-lang="${escapeHtml(lang)}">
  <div class="code-head"><span>${escapeHtml(label)}</span>
    <button class="code-copy" type="button" data-copy>
      <svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>Copiar
    </button>
  </div>
  <pre><code>${highlighted}</code></pre>
</div>`;
  }

  function table(lines, start) {
    const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const header = cells(lines[start]);
    const aligns = cells(lines[start + 1]).map((spec) =>
      spec.startsWith(':') && spec.endsWith(':') ? 'center' : spec.endsWith(':') ? 'right' : spec.startsWith(':') ? 'left' : '');

    let i = start + 2;
    const rows = [];
    while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i++; }

    const attr = (idx) => (aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '');
    const head = header.map((c, idx) => `<th${attr(idx)}>${inline(c)}</th>`).join('');
    const body = rows
      .map((row) => `<tr>${header.map((_, idx) => `<td${attr(idx)}>${inline(row[idx] ?? '')}</td>`).join('')}</tr>`)
      .join('');

    return {
      html: `<div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      next: i,
    };
  }

  /** Constrói uma lista (e suas sublistas) a partir da indentação. */
  function list(lines, start, baseIndent = -1) {
    const first = lines[start].match(RE.ul) || lines[start].match(RE.ol);
    const ordered = !RE.ul.test(lines[start]);
    const indent = first[1].length;
    if (baseIndent >= 0 && indent < baseIndent) return { html: '', next: start };

    const items = [];
    let i = start;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        // Uma linha em branco só encerra a lista se o próximo item não continuar.
        const next = lines[i + 1] ?? '';
        if (!(RE.ul.test(next) || RE.ol.test(next) || /^\s{2,}\S/.test(next))) break;
        i++;
        continue;
      }

      const match = line.match(RE.ul) || line.match(RE.ol);
      if (!match) {
        // Continuação recuada do item corrente.
        if (items.length && /^\s{2,}\S/.test(line)) {
          items[items.length - 1].lines.push(line.replace(/^\s{2,}/, ''));
          i++;
          continue;
        }
        break;
      }

      const itemIndent = match[1].length;
      if (itemIndent < indent) break;

      if (itemIndent > indent) {
        const sub = list(lines, i, itemIndent);
        if (items.length) items[items.length - 1].sub.push(sub.html);
        i = sub.next;
        continue;
      }

      if ((!RE.ul.test(line)) !== ordered) break; // troca de tipo encerra a lista
      items.push({ lines: [match[3]], sub: [] });
      i++;
    }

    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && first[2] !== '1' ? ` start="${parseInt(first[2], 10)}"` : '';
    const body = items.map((item) => {
      const text = item.lines.join('\n');
      const multiline = item.lines.length > 1 || /^\s*(```|>|#{1,6}\s)/.test(text);
      const content = multiline ? parseBlocks(item.lines) : inline(text);
      return `<li>${content}${item.sub.join('')}</li>`;
    }).join('');

    return { html: `<${tag}${startAttr}>${body}</${tag}>`, next: i };
  }

  return { render, inline, escapeHtml };
})();
