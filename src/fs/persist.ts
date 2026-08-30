/**
 * Ask the browser to treat this origin's storage as worth keeping.
 *
 * It matters twice over. On the folder path the stored handle is the only
 * memory of which folder is yours, and losing it means the picker again rather
 * than a prompt. On the device path the notes *are* the site data.
 *
 * Chromium and Safari both decide this silently, on how much the site has been
 * used and whether it is installed, so there is nobody to interrupt and nothing
 * to do if the answer is no.
 */
export async function keepStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    // A browser that will not discuss its storage policy is not a failure.
    return false;
  }
}

/** Whether the browser has promised not to evict this origin's storage. */
export async function storageIsPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
