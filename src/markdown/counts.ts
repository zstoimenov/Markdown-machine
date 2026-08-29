/** Characters in a document, counted the way a person and a paste limit do. */
export function countSymbols(source: string): number {
  // Spread rather than `.length`, so an emoji counts as one symbol, not two.
  return [...source].length;
}

export function countWords(source: string): number {
  const matches = source.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}
