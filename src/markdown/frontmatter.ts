export interface Frontmatter {
  entries: Array<[string, string]>;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Split YAML frontmatter off the top of a note. Deliberately not a YAML parser:
 * the preview only needs flat `key: value` pairs for the metadata strip, and
 * pulling in a full YAML dependency to render a header is not a trade worth
 * making. Anything more structured is simply left out of the strip.
 */
export function splitFrontmatter(source: string): Frontmatter {
  const match = FENCE.exec(source);
  if (!match) return { entries: [], body: source };

  const [, block = ''] = match;
  const entries: Array<[string, string]> = [];

  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0 || /^\s/.test(line)) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["'](.*)["']$/, '$1');
    if (key && value) entries.push([key, value]);
  }

  return { entries, body: source.slice(match[0].length) };
}
