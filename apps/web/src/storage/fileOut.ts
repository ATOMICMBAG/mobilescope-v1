import { Capacitor } from "@capacitor/core";

/**
 * Gibt eine Datei an den Nutzer aus: im Browser als Download, in der Android-App über das
 * Teilen-Menü (Dateien, Mail, Messenger …). Der WebView kann Blob-Downloads nicht selbst speichern.
 */
export async function deliverFile(filename: string, mime: string, text: string): Promise<"download" | "share"> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const file = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: filename, files: [file.uri], dialogTitle: "Session exportieren" });
    return "share";
  }
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "download";
}

export function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return cleaned.slice(0, 60) || "session";
}
