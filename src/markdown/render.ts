import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdownLang from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import DOMPurify from 'dompurify';
import { splitFrontmatter } from './frontmatter';

/**
 * A curated language set rather than highlight.js's `common` bundle, which
 * carried a lot of weight for languages that never appear in a notes folder.
 * Anything not registered here still renders — as plain, escaped code.
 */
for (const [name, language] of Object.entries({
  bash,
  c,
  cpp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  markdown: markdownLang,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
})) {
  hljs.registerLanguage(name, language);
}

// Aliases people actually type in fences.
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['toml'], { languageName: 'ini' });
hljs.registerAliases(['md'], { languageName: 'markdown' });

const md: MarkdownIt = new MarkdownIt({
  html: true, // Notes legitimately contain raw HTML. DOMPurify is what makes this safe.
  linkify: true,
  typographer: true,
  breaks: false,
  // The return type is explicit: without it, referencing `md` inside its own
  // initializer makes the instance type circular and TypeScript gives up.
  highlight(code: string, language: string): string {
    if (language && hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      } catch {
        // Fall through to the escaped-plaintext path below.
      }
    }
    return md.utils.escapeHtml(code);
  },
})
  .use(anchor, { permalink: false, tabIndex: false })
  .use(taskLists, { enabled: false, label: true });

/**
 * Stamp every top-level block with the source line it came from. Scroll sync
 * interpolates between these anchors instead of scrolling both panes by the same
 * percentage, which drifts badly as soon as a document contains anything —
 * a code block, a table, an image — whose rendered height differs from its
 * source height.
 *
 * `state.tokens` is the top level only, which is exactly the granularity worth
 * anchoring: one marker per paragraph, heading, list or fence.
 */
md.core.ruler.push('mm_line_anchors', (state) => {
  const offset: number = (state.env as { mmLineOffset?: number }).mmLineOffset ?? 0;
  for (const token of state.tokens) {
    // nesting -1 is a closing tag, which carries no attributes of its own.
    if (token.map && token.nesting !== -1) {
      token.attrSet('data-line', String(token.map[0] + offset));
    }
  }
  return true;
});

const EXTERNAL = /^(?:https?:|mailto:|data:|blob:)/i;

/**
 * Relative `src` and `href` values point into the vault, not at the web server
 * hosting the app. Park them on data attributes so the browser never fires a
 * doomed request for them, and let <Preview> resolve them against the adapter.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return;

  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src');
    if (src && !EXTERNAL.test(src)) {
      node.setAttribute('data-mm-src', src);
      node.removeAttribute('src');
    }
    return;
  }

  if (node.tagName === 'A') {
    const href = node.getAttribute('href');
    if (!href) return;
    if (EXTERNAL.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else if (!href.startsWith('#')) {
      node.setAttribute('data-mm-href', href);
      node.setAttribute('class', 'mm-internal-link');
      node.removeAttribute('href');
    }
  }
});

export interface RenderedNote {
  html: string;
  frontmatter: Array<[string, string]>;
}

export function renderMarkdown(source: string): RenderedNote {
  const { entries, body } = splitFrontmatter(source);
  // Frontmatter is stripped before parsing, so markdown-it's line numbers are
  // short by however many lines it took up. Put them back on the file's terms.
  const lineOffset = source.slice(0, source.length - body.length).split('\n').length - 1;
  // Every path to the DOM goes through here. There is no unsanitized escape hatch.
  const html = DOMPurify.sanitize(md.render(body, { mmLineOffset: lineOffset }), {
    ADD_ATTR: ['target'],
  });
  return { html, frontmatter: entries };
}
