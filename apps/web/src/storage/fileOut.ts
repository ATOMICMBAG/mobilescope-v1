import { Capacitor } from "@capacitor/core";

/**
 * Gibt eine Datei an den Nutzer aus: im Browser als Download, in der Android-App über das
 * Teilen-Menü (Dateien, Mail, Messenger …). Der WebView kann Blob-Downloads nicht selbst speichern.
 */
export async function deliverBlob(
  filename: string,
  blob: Blob,
  dialogTitle = "Datei teilen",
): Promise<"download" | "share"> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const file = await Filesystem.writeFile({
      path: filename,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    await Share.share({ title: filename, files: [file.uri], dialogTitle });
    return "share";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "download";
}

export function deliverFile(filename: string, mime: string, text: string): Promise<"download" | "share"> {
  return deliverBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }), "Session exportieren");
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Datei konnte nicht gelesen werden."));
    r.readAsDataURL(blob);
  });
}

export function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return cleaned.slice(0, 60) || "session";
}
