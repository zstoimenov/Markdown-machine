import { useEffect, useMemo, useRef } from 'react';
import { renderMarkdown } from '../markdown/render.ts';
import { isMarkdownFile, resolvePath } from '../fs/types.ts';
import { useVault } from '../state/vaultStore.ts';

export function Preview({ source, path }: { source: string; path: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const adapter = useVault((s) => s.adapter);
  const openFile = useVault((s) => s.openFile);

  const { html, frontmatter } = useMemo(() => renderMarkdown(source), [source]);

  // Swap vault-relative image references for object URLs read through the adapter.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !adapter) return;

    let cancelled = false;
    const urls: string[] = [];

    void (async () => {
      const images = Array.from(container.querySelectorAll<HTMLImageElement>('img[data-mm-src]'));
      for (const image of images) {
        const reference = image.dataset.mmSrc;
        if (!reference) continue;
        try {
          const blob = await adapter.readBinary(resolvePath(path, decodeURI(reference)));
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          image.src = url;
        } catch {
          if (cancelled) return;
          image.replaceWith(
            Object.assign(document.createElement('span'), {
              className: 'missing-image',
              textContent: `Missing image: ${reference}`,
            }),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
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
