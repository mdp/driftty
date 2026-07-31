const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('');
const storageKey = 'driftty:agent-letter-order';

type LetterStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadAgentLetters(storage?: LetterStorage): string[] {
  try {
    const saved = storage?.getItem(storageKey) ?? '';
    const prioritized = [...saved].filter(
      (letter, index, letters) =>
        alphabet.includes(letter) && letters.indexOf(letter) === index,
    );
    return [
      ...prioritized,
      ...alphabet.filter((letter) => !prioritized.includes(letter)),
    ];
  } catch {
    return [...alphabet];
  }
}

export function rememberAgentLetter(
  storage: LetterStorage | undefined,
  letter: string,
): string[] {
  const letters = loadAgentLetters(storage);
  if (!alphabet.includes(letter)) return letters;
  const reordered = [letter, ...letters.filter((item) => item !== letter)];
  try {
    storage?.setItem(storageKey, reordered.join(''));
  } catch {
    // The in-memory order still applies when storage is unavailable.
  }
  return reordered;
}
