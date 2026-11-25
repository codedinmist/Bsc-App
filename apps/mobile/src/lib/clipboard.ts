import * as Clipboard from "expo-clipboard";

/** Copies text and clears the clipboard after 30 s, but only if it still holds what we copied. */
export async function copyTemporarily(text: string) {
  await Clipboard.setStringAsync(text);
  setTimeout(async () => {
    try { if ((await Clipboard.getStringAsync()) === text) await Clipboard.setStringAsync(""); } catch { /* ignore */ }
  }, 30_000);
}
