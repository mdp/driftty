export type ComposerAction = 'insert' | 'insert-return';

export interface ComposerSubmission {
  text: string;
  enter: boolean;
}

export function composerSubmission(
  value: string,
  action: ComposerAction,
): ComposerSubmission {
  return {
    text: value,
    enter: action === 'insert-return',
  };
}
