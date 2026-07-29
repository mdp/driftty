export interface TerminalIdentity {
  host: string;
  session?: string;
}

function displayName(value: string): string {
  const decoded = decodeURIComponent(value);
  return decoded.charAt(0).toUpperCase() + decoded.slice(1);
}

export function terminalIdentity(pathname: string): TerminalIdentity {
  const parts = pathname.split('/').filter(Boolean);
  return {
    host: parts[0] ? displayName(parts[0]) : 'Terminal',
    session: parts[1] ? decodeURIComponent(parts[1]) : undefined,
  };
}
