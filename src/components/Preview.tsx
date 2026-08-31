import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown } from '../markdown/render.ts';
import { isMarkdownFile, resolvePath } from '../fs/types.ts';
import { useVault } from '../state/vaultStore.ts';

export function Preview({ source, path }: { source: string; path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapter = useVault((s) => s.adapter);
  const openFile = useVault((s) => s.openFile);

  const { html, frontmatter } = useMemo(() => renderMarkdown(source), [source]);

  /**
   * Resolved images, kept across renders.
   *
   * Every edit produces new HTML and therefore new `<img>` elements, which have
   * to be pointed at their bytes again — but the bytes themselves have not
   * changed. Reading them again is what this cache exists to stop: without it a
   * note with a few screenshots in it read every one of them off disk, decoded
   * them and threw them away on each keystroke, which is a great deal of work to
   * do while somebody is typing a sentence.
   *
   * A promise per path rather than a URL, so two images sharing a source, or a
   * second render arriving before the first read finishes, still make one read.
   */
  const cacheRef = useRef(new Map<string, Promise<string | null>>());

  // Bytes belong to the vault and the note that resolved them. When either
  // changes the URLs are stale, so they are revoked and the cache starts again.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const pending of cache.values()) {
        void pending.then((url) => {
          if (url !== null) URL.revokeObjectURL(url);
        });
      }
      cache.clear();
    };
  }, [adapter, path]);

  // Swap vault-relative image references for object URLs read through the adapter.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !adapter) return;

    let cancelled = false;
    const cache = cacheRef.current;

    function resolve(reference: string): Promise<string | null> {
      const target = resolvePath(path, decodeURI(reference));
      let pending = cache.get(target);
      if (pending === undefined) {
        pending = adapter!
          .readBinary(target)
          .then((blob) => URL.createObjectURL(blob))
          .catch(() => null);
        cache.set(target, pending);
      }
      return pending;
    }

    void (async () => {
      const images = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-mm-src]'));
      for (const image of images) {
        const reference = image.dataset.mmSrc;
        if (!reference) continue;
        const url = await resolve(reference);
        if (cancelled) return;
        if (url === null) {
          image.replaceWith(
            Object.assign(document.createElement('span'), {
              className: 'missing-image',
              textContent: `Missing image: ${reference}`,
            }),
          );
        } else {
          image.src = url;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html, adapter, path]);

  // Links between notes navigate inside the vault rather than out to the web.
  function onClick(event: React.MouseEvent<HTMLDivElement>) {
    const link = (event.target as HTMLElement).closest<HTMLElement>('[data-mm-href]');
    const reference = link?.dataset.mmHref;
    if (!reference) return;
    event.preventDefault();
    const [target = ''] = reference.split('#');
    const resolved = resolvePath(path, decodeURI(target));
    if (isMarkdownFile(resolved)) void openFile(resolved);
  }

  return (
    <article className="preview" onClick={onClick}>
      {frontmatter.length > 0 && (
        <dl className="frontmatter">
          {frontmatter.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div
        ref={containerRef}
        className="prose"
        // Sanitized in renderMarkdown; this is the only innerHTML in the app.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
