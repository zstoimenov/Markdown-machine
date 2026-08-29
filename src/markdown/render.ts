import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { splitFrontmatter } from './frontmatter';

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
  // Every path to the DOM goes through here. There is no unsanitized escape hatch.
  const html = DOMPurify.sanitize(md.render(body), { ADD_ATTR: ['target'] });
  return { html, frontmatter: entries };
}
