export type ComposerAction = 'insert' | 'insert-return';

export function composerPayload(
  value: string,
  action: ComposerAction,
): string {
  return action === 'insert-return' ? `${value}\r` : value;
}
