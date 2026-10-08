/** Wraps text in double quotes, escaping the characters the parser unescapes. */
export function doubleQuote(text: string): string {
  return `"${text.replace(/(["\\])/g, '\\$1')}"`;
}

/** Whether a bare word would be split, unquoted, or read as an option or comment. */
export function needsQuotes(text: string): boolean {
  return text === '' || /[\s"'\\]/.test(text) || /^[-#]/.test(text);
}

/** Quotes a name when needed, keeping the quote style of the token it replaces. */
export function quoteName(name: string, original: string): string {
  const existing = /^["']/.test(original) ? original[0] : undefined;
  if (existing === "'" && !name.includes("'")) return `'${name}'`;
  if (existing || needsQuotes(name)) return doubleQuote(name);
  return name;
}
