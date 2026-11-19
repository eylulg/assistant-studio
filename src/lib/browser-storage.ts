/** The browser's local storage, or null where it is blocked. Reading `window.localStorage` can throw. */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
