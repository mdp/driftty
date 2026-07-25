export const AUTO_RECONNECT_STORAGE_KEY = 'ttyd-auto-reconnect';
export const MAX_RECONNECT_ATTEMPTS = 5;

const BASE_RECONNECT_DELAY_MS = 500;

export function reconnectDelay(attempt: number): number {
  return BASE_RECONNECT_DELAY_MS * 2 ** Math.max(0, attempt - 1);
}

export function initialAutoReconnect(): boolean {
  try {
    return localStorage.getItem(AUTO_RECONNECT_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function storeAutoReconnect(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_RECONNECT_STORAGE_KEY, String(enabled));
  } catch {
    // Storage can be disabled in privacy-focused browsers.
  }
}
