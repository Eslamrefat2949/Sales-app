/** Saving files on the phone or computer: Excel sheets, the closing photo and the upload templates. */

/** File names must work on Android, iOS, Windows and inside Odoo's import dialog. */
export function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Starts a normal browser download. On Android it lands in Downloads (and photos show in the gallery). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(fileName);
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Safari needs the URL a little longer than the click.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function isAppleMobile(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function shareable(file: File): boolean {
  return (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  );
}

export type SaveResult = 'saved' | 'shared' | 'cancelled';

/**
 * Saves a photo where people look for it. iPhone downloads go to Files, not Photos, so on iPhone the
 * share sheet opens (it has "Save Image"); everywhere else the photo downloads directly.
 */
export async function savePhoto(blob: Blob, fileName: string): Promise<SaveResult> {
  const file = new File([blob], safeFileName(fileName), { type: blob.type || 'image/png' });
  if (isAppleMobile() && shareable(file)) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, fileName);
  return 'saved';
}

/** Opens the share sheet (WhatsApp and so on) with the file, or downloads it where sharing files is not supported. */
export async function shareFile(blob: Blob, fileName: string, title: string): Promise<SaveResult> {
  const file = new File([blob], safeFileName(fileName), { type: blob.type });
  if (shareable(file)) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, fileName);
  return 'saved';
}

export function canShareFiles(): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}
