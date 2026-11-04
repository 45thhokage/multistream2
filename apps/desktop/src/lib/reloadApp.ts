export function reloadApp(): void {
  window.location.reload();
}

export async function forceReloadApp(): Promise<void> {
  if (window.caches) {
    const keys = await window.caches.keys().catch((): string[] => []);
    await Promise.allSettled(keys.map((key) => window.caches.delete(key)));
  }
  window.location.reload();
}
