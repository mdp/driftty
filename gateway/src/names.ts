const adjectives = [
  'bold', 'brave', 'bright', 'calm', 'clever', 'cool', 'eager', 'gentle',
  'happy', 'kind', 'lucid', 'merry', 'nimble', 'quiet', 'rapid', 'serene',
  'sharp', 'steady', 'swift', 'vivid',
];

const names = [
  'ada', 'babbage', 'curie', 'darwin', 'einstein', 'faraday', 'franklin',
  'hopper', 'lovelace', 'newton', 'noether', 'pasteur', 'raman', 'sagan',
  'shannon', 'tesla', 'turing', 'volta', 'wilson', 'wu',
];

export function randomSessionName(random = Math.random): string {
  const adjective = adjectives[Math.floor(random() * adjectives.length)]!;
  const name = names[Math.floor(random() * names.length)]!;
  return `${adjective}-${name}`;
}

export function sessionSlug(value: string): string {
  const slug = value.trim();
  if (slug.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(
      'shell name must use lowercase letters, numbers, and single hyphens (64 characters max)',
    );
  }
  return slug;
}
