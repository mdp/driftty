export function cleanCopyText(text: string): string {
  return text.replace(/[ \t]+(?=\r?$)/gm, '');
}
