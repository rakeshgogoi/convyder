/** `AudioWorkletNode.addModule(url)` uses its own internal module fetch that
 * doesn't reliably resolve `file://` URLs inside a packaged app's asar
 * archive (unlike our own `fetch()`/script loading, which Electron patches
 * correctly). Fetching the source ourselves and loading it as a Blob URL
 * sidesteps that gap in both dev (http://) and packaged (file://) builds. */
export async function loadWorkletModule(audioContext: BaseAudioContext, moduleUrl: string): Promise<void> {
  const response = await fetch(moduleUrl);
  const code = await response.text();
  const blobUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  try {
    await audioContext.audioWorklet.addModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
