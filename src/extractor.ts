/**
 * The extractor: the readable text of one HTML page, as plain text.
 *
 * research has no runtime dependency (ADR-0001), so there is no HTML parser
 * here, only a tokenizer that is good enough for the one thing it is for:
 * finding the words a person reads. It drops what is never the page's
 * subject (scripts, styles, menus, headers, footers, asides and forms), takes
 * the `<article>`, then the `<main>`, then the `<body>`, and keeps headings,
 * paragraphs and list items as blocks of plain text with a blank line between
 * them. HTML entities are decoded, so the text reads as the page shows it.
 *
 * A browser forgives broken HTML in more ways than this does. A page this
 * reads badly still gives an Extract, and the operator sees its text.
 */

/** Elements whose text is never the page's subject: dropped, with all they hold. */
const DROPPED = new Set([
  'head',
  'title',
  'script',
  'style',
  'noscript',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'template',
  'svg',
  'iframe',
]);

/** Elements whose content is raw text up to their end tag, never markup. */
const RAW_TEXT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
]);

/** Elements that have no end tag. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Elements that start and end a block of text. */
const BLOCKS = new Set([
  'address',
  'article',
  'blockquote',
  'body',
  'caption',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hgroup',
  'hr',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'thead',
  'tfoot',
  'tr',
  'ul',
]);

/** The parts of the page, in the order this looks for them (ADR-0001). */
const REGIONS = ['article', 'main', 'body'];

type Token =
  | { readonly kind: 'open'; readonly name: string }
  | { readonly kind: 'close'; readonly name: string }
  | { readonly kind: 'text'; readonly text: string };

/** The readable text of an HTML page: blocks of plain text, a blank line between them. */
export function readableText(html: string): string {
  const tokens = kept(tokenize(html));
  return textOf(regionOf(tokens));
}

/** Plain text as research keeps it: its own line ends, and no blank edges. */
export function plainText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The page as a flat list of tags and text, with comments and doctypes gone. */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
  let at = 0;
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    if (lt < 0) {
      tokens.push({ kind: 'text', text: html.slice(at) });
      break;
    }
    if (lt > at) tokens.push({ kind: 'text', text: html.slice(at, lt) });
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      at = end < 0 ? html.length : end + 1;
      continue;
    }
    tag.lastIndex = lt;
    const found = tag.exec(html);
    if (found === null) {
      // A '<' that starts no tag is text, as a browser reads it.
      tokens.push({ kind: 'text', text: '<' });
      at = lt + 1;
      continue;
    }
    const name = (found[2] ?? '').toLowerCase();
    at = tag.lastIndex;
    if (found[1] === '/') {
      tokens.push({ kind: 'close', name });
      continue;
    }
    tokens.push({ kind: 'open', name });
    if (VOID.has(name) || (found[3] ?? '').trimEnd().endsWith('/')) {
      tokens.push({ kind: 'close', name });
      continue;
    }
    if (RAW_TEXT.has(name)) {
      // A script may hold '<' and whole tags in a string, so its end is found
      // by its end tag alone.
      const end = new RegExp(`</${name}\\s*>`, 'ig');
      end.lastIndex = at;
      const closed = end.exec(html);
      const stop = closed === null ? html.length : closed.index;
      tokens.push({ kind: 'text', text: html.slice(at, stop) });
      tokens.push({ kind: 'close', name });
      at = closed === null ? html.length : end.lastIndex;
    }
  }
  return tokens;
}

/** The tokens without the dropped elements and everything inside them. */
function kept(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  let dropping: string | null = null;
  let depth = 0;
  for (const token of tokens) {
    // A `</head>` may be left out, and the `<body>` ends the head all the same.
    if (dropping === 'head' && token.kind === 'open' && token.name === 'body') dropping = null;
    if (dropping !== null) {
      if (token.kind === 'open' && token.name === dropping) depth += 1;
      if (token.kind === 'close' && token.name === dropping) depth -= 1;
      if (depth === 0) dropping = null;
      continue;
    }
    if (token.kind === 'open' && DROPPED.has(token.name)) {
      dropping = token.name;
      depth = 1;
      continue;
    }
    out.push(token);
  }
  return out;
}

/** The first `<article>`, else the `<main>`, else the `<body>`, else the whole page. */
function regionOf(tokens: readonly Token[]): readonly Token[] {
  for (const name of REGIONS) {
    const start = tokens.findIndex((token) => token.kind === 'open' && token.name === name);
    if (start < 0) continue;
    let depth = 0;
    for (let at = start; at < tokens.length; at += 1) {
      const token = tokens[at]!;
      if (token.kind === 'open' && token.name === name) depth += 1;
      if (token.kind === 'close' && token.name === name) depth -= 1;
      if (depth === 0) return tokens.slice(start + 1, at);
    }
    return tokens.slice(start + 1);
  }
  return tokens;
}

/** The text of the tokens, one block for each heading, paragraph or list item. */
function textOf(tokens: readonly Token[]): string {
  const blocks: { readonly text: string; readonly item: boolean }[] = [];
  let line = '';
  let item = false;
  let pre = 0;
  const flush = (): void => {
    const text = line
      .split('\n')
      .map((part) => (pre > 0 ? part.trimEnd() : part.replace(/ {2,}/g, ' ').trim()))
      .join('\n')
      .trim();
    if (text !== '') blocks.push({ text: item ? `- ${text}` : text, item });
    line = '';
    item = false;
  };
  for (const token of tokens) {
    if (token.kind === 'text') {
      // A line end in the markup is a space; only a `<br>` or a `<pre>` keeps one.
      const text = decodeEntities(token.text);
      line += pre > 0 ? text : text.replace(/\s+/g, ' ');
      continue;
    }
    if (token.name === 'br') {
      if (token.kind === 'open') line += '\n';
      continue;
    }
    if (token.name === 'td' || token.name === 'th') {
      line += ' ';
      continue;
    }
    if (!BLOCKS.has(token.name)) continue;
    flush();
    if (token.name === 'pre') pre = Math.max(0, pre + (token.kind === 'open' ? 1 : -1));
    if (token.name === 'li' && token.kind === 'open') item = true;
  }
  flush();
  // List items sit on lines of their own; every other block has a blank line around it.
  return blocks
    .map((block, at) => {
      const before = blocks[at - 1];
      if (before === undefined) return block.text;
      return (before.item && block.item ? '\n' : '\n\n') + block.text;
    })
    .join('');
}

/** The named entities a page is likely to use. Any other one is kept as it was written. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  para: '¶',
  sect: '§',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  larr: '←',
  rarr: '→',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  le: '≤',
  ge: '≥',
  ne: '≠',
  minus: '−',
  prime: '′',
  Prime: '″',
  dagger: '†',
  zwj: '‍',
  zwnj: '‌',
  iexcl: '¡',
  iquest: '¿',
  ordf: 'ª',
  ordm: 'º',
  szlig: 'ß',
};

/** Accented letters by the name of their accent, as `&atilde;` and `&Ccedil;` name them. */
const ACCENTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  acute: {
    a: 'á',
    e: 'é',
    i: 'í',
    o: 'ó',
    u: 'ú',
    y: 'ý',
    A: 'Á',
    E: 'É',
    I: 'Í',
    O: 'Ó',
    U: 'Ú',
    Y: 'Ý',
  },
  grave: { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  circ: { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  tilde: { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  uml: { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  cedil: { c: 'ç', C: 'Ç' },
};

/** Text with its HTML entities decoded: named, decimal and hexadecimal. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole, name: string) => {
      if (name.startsWith('#')) {
        const hex = name[1] === 'x' || name[1] === 'X';
        const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      const named = ENTITIES[name];
      if (named !== undefined) return named;
      const accent = /^([a-zA-Z])(acute|grave|circ|tilde|uml|cedil)$/.exec(name);
      return (accent && ACCENTS[accent[2]!]?.[accent[1]!]) || whole;
    },
  );
}
