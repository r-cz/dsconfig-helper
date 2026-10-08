/** Last path segment of a URI, decoded. */
export function uriBasename(uri: string): string {
  const path = uri.split(/[?#]/)[0];
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

/** Markdown link that opens a file at a zero-based line. */
export function locationLink(uri: string, line: number): string {
  return `[${uriBasename(uri)}:${line + 1}](${uri}#L${line + 1})`;
}
