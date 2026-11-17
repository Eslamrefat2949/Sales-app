import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { useNotify } from '../../components/Toast.tsx';
import type { AppConfig } from '../../data/appData.ts';
import {
  batchDates,
  closingFileStem,
  odooSheet,
  recordSheetDownload,
  type ClosedDay,
} from '../../data/branchInvoices.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { canShareFiles, downloadBlob, savePhoto, shareFile } from '../../lib/files.ts';
import { closingPhotoData, renderClosingPhoto } from './closingPhoto.ts';

interface ClosingSheetProps {
  readonly config: AppConfig;
  readonly closed: ClosedDay;
  /** True right after closing: the sheet was already downloaded once and the photo still has to be saved. */
  readonly fresh: boolean;
  readonly sheetDownloaded: boolean;
  readonly onClose: () => void;
  /** Called after a repeated sheet download was recorded, so the history can show the new count. */
  readonly onRecorded: () => void;
}

/**
 * The closing register: the photo of the close to save on the phone, plus the Odoo sheet.
 * Saving and sharing are buttons because phones only allow them straight after a tap.
 */
export function ClosingSheet({ config, closed, fresh, sheetDownloaded, onClose, onRecorded }: ClosingSheetProps) {
  const { t, lang } = useI18n();
  const notify = useNotify();
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | 'failed' | null>(null);
  const [photoSaved, setPhotoSaved] = useState(false);
  const [sheetDone, setSheetDone] = useState(sheetDownloaded);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const stem = closingFileStem(config, closed.batch);
  const photoName = `${stem} - closing.png`;

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    renderClosingPhoto(closingPhotoData(t, lang, config, closed))
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPhoto({ blob, url });
      })
      .catch(() => {
        if (!cancelled) setPhoto('failed');
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [t, lang, config, closed]);

  const save = async () => {
    if (!photo || photo === 'failed') return;
    const result = await savePhoto(photo.blob, photoName);
    if (result !== 'cancelled') setPhotoSaved(true);
  };

  const share = async () => {
    if (!photo || photo === 'failed') return;
    await shareFile(photo.blob, photoName, `${t.exportTitle} · ${config.branch?.code ?? ''}`);
  };

  const downloadSheet = async () => {
    // Downloading an earlier close again is counted on the server, after a warning.
    if (!fresh && !confirmAgain) {
      setConfirmAgain(true);
      return;
    }
    setBusy(true);
    try {
      const sheet = await odooSheet(config, closed);
      if (!fresh) {
        await recordSheetDownload(closed.batch.id);
        onRecorded();
      }
      downloadBlob(sheet.blob, sheet.fileName);
      setSheetDone(true);
      setConfirmAgain(false);
    } catch {
      notify(t.genericError, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={fresh ? t.closedTitle : t.closingPhoto}
      subtitle={
        <bdi dir="ltr" className="tabular">
          {config.branch?.code} · {batchDates(closed.batch)}
        </bdi>
      }
      closeLabel={t.close}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3 pb-2">
        {fresh ? (
          <p className="animate-pop flex items-center gap-2 rounded-2xl bg-tile-blue p-3 font-semibold text-tile-blue-fg">
            <Icon name="download" className="h-5 w-5 shrink-0" />
            {t.closedSavePhoto}
          </p>
        ) : null}

        <div className="max-h-[42vh] overflow-y-auto rounded-2xl bg-surface-2 p-2">
          {photo === null ? (
            <p className="p-6 text-center text-sm text-muted" role="status">
              {t.makingPhoto}
            </p>
          ) : photo === 'failed' ? (
            <p className="p-6 text-center text-sm text-danger">{t.photoFailed}</p>
          ) : (
            <img
              src={photo.url}
              alt={`${t.closingPhoto} ${config.branch?.code ?? ''} ${batchDates(closed.batch)}`}
              className="animate-rise w-full rounded-xl shadow-card"
            />
          )}
        </div>

        <button
          type="button"
          disabled={!photo || photo === 'failed'}
          onClick={() => void save()}
          className={`press flex h-14 items-center justify-center gap-2 rounded-2xl text-lg font-semibold shadow-card disabled:opacity-50 ${
            photoSaved ? 'bg-free text-white' : 'bg-primary text-primary-fg'
          }`}
        >
          <Icon name={photoSaved ? 'check' : 'download'} />
          {photoSaved ? t.photoSavedDone : t.savePhoto}
        </button>

        <div className={`grid gap-2 ${canShareFiles() ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {canShareFiles() ? (
            <button
              type="button"
              disabled={!photo || photo === 'failed'}
              onClick={() => void share()}
              className="press flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface-2 font-semibold disabled:opacity-50"
            >
              <Icon name="upload" className="h-4 w-4" />
              {t.share}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void downloadSheet()}
            className="press flex h-12 items-center justify-center gap-2 rounded-2xl bg-surface-2 px-3 text-sm font-semibold disabled:opacity-50"
          >
            <Icon name={sheetDone ? 'check' : 'receipt'} className="h-4 w-4 shrink-0" />
            {sheetDone ? t.sheetDownloadedDone : t.downloadSheet}
          </button>
        </div>

        {confirmAgain ? (
          <div className="animate-pop flex flex-col gap-2 rounded-2xl bg-promo-bg p-3">
            <p className="text-sm text-promo">{t.exportAgainWarning}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadSheet()}
              className="press h-12 rounded-xl bg-primary font-semibold text-primary-fg disabled:opacity-50"
            >
              {t.downloadAgain}
            </button>
          </div>
        ) : null}

        {fresh ? <p className="text-center text-xs text-muted">{t.invoiceNumbersNote}</p> : null}
      </div>
    </Sheet>
  );
}
