import { buildSalesReport } from '@ravin-sales/domain';
import type { AppConfig } from '../../data/appData.ts';
import type { ClosedDay } from '../../data/branchInvoices.ts';
import type { Lang, Messages } from '../../i18n/messages.ts';
import { formatMoney } from '../../lib/format.ts';

/**
 * The closing photo: a one-page register of the close (branch, sale date, totals, payment methods,
 * sales people, voids) that the branch keeps on the phone and can send on WhatsApp.
 * Drawn on a canvas so it works offline and needs no extra library.
 */
export interface ClosingPhotoData {
  readonly dir: 'rtl' | 'ltr';
  readonly title: string;
  readonly branchLine: string;
  readonly datesLine: string;
  readonly closedLine: string;
  readonly totalLabel: string;
  readonly total: string;
  readonly currency: string;
  readonly tiles: readonly { readonly label: string; readonly value: string }[];
  readonly paymentsTitle: string;
  readonly payments: readonly { readonly label: string; readonly value: string }[];
  readonly peopleTitle: string;
  readonly people: readonly { readonly name: string; readonly detail: string; readonly value: string }[];
  readonly footer: string;
}

const locale = (lang: Lang) => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB');

function formatDay(date: string, lang: Lang, withYear: boolean): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(locale(lang), {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

export function closingPhotoData(t: Messages, lang: Lang, config: AppConfig, closed: ClosedDay): ClosingPhotoData {
  const { batch, invoices } = closed;
  const report = buildSalesReport(invoices);
  const summary = report.overall;
  const money = (amount: number) => `${formatMoney(amount)} ${t.currency}`;
  const methodLabel = (code: string) =>
    config.paymentMethods.find((method) => method.code === code)?.label[lang] ?? code;
  const nameOf = (id: string) =>
    invoices.find((invoice) => invoice.salesPersonId === id)?.salesPersonName ??
    config.employees.find((employee) => employee.id === id)?.name ??
    '—';
  const days =
    batch.firstDate === batch.lastDate
      ? formatDay(batch.firstDate, lang, true)
      : `${formatDay(batch.firstDate, lang, false)} – ${formatDay(batch.lastDate, lang, true)}`;
  const closedAt = new Date(batch.createdAt).toLocaleString(locale(lang), {
    timeZone: 'Africa/Cairo',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    title: t.exportTitle,
    branchLine: config.branch ? `${config.branch.code} · ${config.branch.posName}` : '',
    datesLine: t.photoSalesOf(days),
    closedLine: t.photoClosedAt(closedAt),
    totalLabel: t.sales,
    total: formatMoney(summary.total),
    currency: t.currency,
    tiles: [
      { label: t.invoicesLabel, value: String(summary.invoiceCount) },
      { label: t.piecesLabel, value: String(summary.unitCount) },
      { label: t.averageInvoice, value: money(summary.averageInvoice) },
      { label: t.voided, value: t.voidedSummary(batch.voidedCount, money(batch.voidedTotal)) },
    ],
    paymentsTitle: t.byPaymentMethod,
    payments: Object.entries(summary.byPaymentMethod)
      .filter(([, amount]) => amount !== 0)
      .sort((a, b) => b[1] - a[1])
      .map(([code, amount]) => ({ label: methodLabel(code), value: money(amount) })),
    peopleTitle: t.bySalesPerson,
    people: Object.entries(report.bySalesPerson)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([id, person]) => ({
        name: nameOf(id),
        detail: `${t.invoices(person.invoiceCount)} · ${t.pieces(person.unitCount)}`,
        value: money(person.total),
      })),
    footer: t.photoFooter,
  };
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

const WIDTH = 1080;
const PAD = 56;
const GAP = 28;
const HERO = 400;
const TOTAL = 230;
const TILE = 170;
const ROW = 70;
const PERSON_ROW = 96;
const CARD_HEAD = 110;
const CARD_FOOT = 30;
const FOOTER = 90;

const UI = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, system-ui, sans-serif';
const DISPLAY = '"Readex Pro", "IBM Plex Sans Arabic", "Segoe UI", system-ui, sans-serif';

/** Colours come from the app's design tokens, so the photo matches the screens. */
function palette() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    bg: token('--bg', '#f2f5fb'),
    surface: token('--surface', '#ffffff'),
    fg: token('--fg', '#0f1b2d'),
    muted: token('--muted', '#6b7a90'),
    line: token('--line', '#e3e9f2'),
    primary: token('--primary', '#2563eb'),
    primary2: token('--primary-2', '#4f8ff7'),
    primaryDeep: token('--primary-deep', '#1d4ed8'),
    tiles: [
      [token('--tile-blue', '#eaf2ff'), token('--tile-blue-fg', '#2563eb')],
      [token('--tile-green', '#e6f7ee'), token('--tile-green-fg', '#15803d')],
      [token('--tile-amber', '#fff3e2'), token('--tile-amber-fg', '#c2620a')],
      [token('--tile-purple', '#f1ecff'), token('--tile-purple-fg', '#6d3fe0')],
    ] as const,
  };
}

async function fontsReady(): Promise<void> {
  if (!('fonts' in document)) return;
  const sample = 'تقفيل المبيعات RAVIN 0123456789';
  const loads = Promise.all([
    document.fonts.load(`600 64px "Readex Pro"`, sample),
    document.fonts.load(`400 30px "IBM Plex Sans Arabic"`, sample),
    document.fonts.load(`500 30px "IBM Plex Sans Arabic"`, sample),
    document.fonts.load(`600 30px "IBM Plex Sans Arabic"`, sample),
  ]).catch(() => undefined);
  // Offline without cached fonts the system font is used; never wait long for it.
  await Promise.race([loads, new Promise((resolve) => setTimeout(resolve, 2500))]);
}

const ARABIC = /[؀-ۿ]/;

interface TextStyle {
  readonly font: string;
  readonly color: string;
  readonly align: 'left' | 'right' | 'center';
  readonly maxWidth?: number;
}

function drawText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, style: TextStyle): void {
  ctx.font = style.font;
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align;
  ctx.direction = ARABIC.test(value) ? 'rtl' : 'ltr';
  let text = value;
  if (style.maxWidth && ctx.measureText(text).width > style.maxWidth) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > style.maxWidth) text = text.slice(0, -1);
    text = `${text.trimEnd()}…`;
  }
  ctx.fillText(text, x, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.save();
  ctx.shadowColor = 'rgba(37, 99, 235, 0.10)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, x, y, w, h, 40);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Renders the closing photo as a PNG. */
export async function renderClosingPhoto(data: ClosingPhotoData): Promise<Blob> {
  await fontsReady();
  const colors = palette();
  const paymentsHeight = CARD_HEAD + Math.max(1, data.payments.length) * ROW + CARD_FOOT;
  const peopleHeight = CARD_HEAD + Math.max(1, data.people.length) * PERSON_ROW + CARD_FOOT;
  const height =
    PAD + HERO + GAP + TOTAL + GAP + TILE * 2 + 24 + GAP + paymentsHeight + GAP + peopleHeight + FOOTER + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_UNAVAILABLE');
  ctx.textBaseline = 'alphabetic';

  const rtl = data.dir === 'rtl';
  const left = PAD;
  const right = WIDTH - PAD;
  const inner = 48;
  /** Start and end of a line inside a card, following the reading direction. */
  const start = rtl ? right - inner : left + inner;
  const end = rtl ? left + inner : right - inner;
  const startAlign = rtl ? 'right' : 'left';
  const endAlign = rtl ? 'left' : 'right';

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, WIDTH, height);

  // Header: blue gradient with the brand, the title, the branch and the sale date.
  let y = PAD;
  const gradient = ctx.createLinearGradient(left, y, right, y + HERO);
  gradient.addColorStop(0, colors.primaryDeep);
  gradient.addColorStop(0.45, colors.primary);
  gradient.addColorStop(1, colors.primary2);
  roundRect(ctx, left, y, right - left, HERO, 48);
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.beginPath();
  ctx.arc(right - 40, y - 30, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.beginPath();
  ctx.arc(left + 60, y + HERO + 40, 200, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Brand mark: always left to right.
  roundRect(ctx, left + inner, y + 44, 72, 72, 20);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  drawText(ctx, 'R', left + inner + 36, y + 96, {
    font: `700 44px ${DISPLAY}`,
    color: colors.primary,
    align: 'center',
  });
  ctx.letterSpacing = '6px';
  drawText(ctx, 'RAVIN', left + inner + 96, y + 78, { font: `600 32px ${DISPLAY}`, color: '#ffffff', align: 'left' });
  ctx.letterSpacing = '5px';
  drawText(ctx, 'SALES', left + inner + 96, y + 110, {
    font: `500 20px ${UI}`,
    color: 'rgba(255,255,255,0.75)',
    align: 'left',
  });
  ctx.letterSpacing = '0px';

  const heroWidth = right - left - inner * 2;
  drawText(ctx, data.title, start, y + 210, {
    font: `600 66px ${DISPLAY}`,
    color: '#ffffff',
    align: startAlign,
    maxWidth: heroWidth,
  });
  drawText(ctx, data.branchLine, start, y + 272, {
    font: `600 36px ${UI}`,
    color: 'rgba(255,255,255,0.95)',
    align: startAlign,
    maxWidth: heroWidth,
  });
  drawText(ctx, data.datesLine, start, y + 324, {
    font: `500 30px ${UI}`,
    color: 'rgba(255,255,255,0.88)',
    align: startAlign,
    maxWidth: heroWidth,
  });
  drawText(ctx, data.closedLine, start, y + 368, {
    font: `400 26px ${UI}`,
    color: 'rgba(255,255,255,0.75)',
    align: startAlign,
    maxWidth: heroWidth,
  });

  // Total.
  y += HERO + GAP;
  card(ctx, left, y, right - left, TOTAL, colors.surface);
  drawText(ctx, data.totalLabel, start, y + 72, { font: `500 32px ${UI}`, color: colors.muted, align: startAlign });
  ctx.font = `600 104px ${DISPLAY}`;
  ctx.direction = 'ltr';
  const amountWidth = ctx.measureText(data.total).width;
  ctx.font = `500 40px ${UI}`;
  const currencyWidth = ctx.measureText(data.currency).width;
  const groupWidth = amountWidth + 18 + currencyWidth;
  // The currency sits where the rest of the app puts it: before the amount in Arabic, after it in English.
  const groupLeft = rtl ? start - groupWidth : start;
  const amountLeft = rtl ? groupLeft + currencyWidth + 18 : groupLeft;
  const currencyLeft = rtl ? groupLeft : groupLeft + amountWidth + 18;
  drawText(ctx, data.total, amountLeft, y + 186, { font: `600 104px ${DISPLAY}`, color: colors.fg, align: 'left' });
  drawText(ctx, data.currency, currencyLeft, y + 186, {
    font: `500 40px ${UI}`,
    color: colors.muted,
    align: 'left',
  });

  // Tiles: invoices, pieces, average, voided.
  y += TOTAL + GAP;
  const tileWidth = (right - left - 24) / 2;
  data.tiles.forEach((tile, index) => {
    const column = rtl ? 1 - (index % 2) : index % 2;
    const x = left + column * (tileWidth + 24);
    const top = y + Math.floor(index / 2) * (TILE + 24);
    const [background, foreground] = colors.tiles[index % colors.tiles.length]!;
    roundRect(ctx, x, top, tileWidth, TILE, 32);
    ctx.fillStyle = background;
    ctx.fill();
    const tileStart = rtl ? x + tileWidth - 36 : x + 36;
    drawText(ctx, tile.label, tileStart, top + 60, {
      font: `600 28px ${UI}`,
      color: foreground,
      align: startAlign,
      maxWidth: tileWidth - 72,
    });
    drawText(ctx, tile.value, tileStart, top + 130, {
      font: `600 46px ${DISPLAY}`,
      color: colors.fg,
      align: startAlign,
      maxWidth: tileWidth - 72,
    });
  });

  // A titled list card (payment methods, sales people).
  const listCard = (
    top: number,
    cardHeight: number,
    title: string,
    rows: readonly { readonly label: string; readonly detail?: string; readonly value: string }[],
    rowHeight: number,
  ) => {
    card(ctx, left, top, right - left, cardHeight, colors.surface);
    drawText(ctx, title, start, top + 76, { font: `600 36px ${DISPLAY}`, color: colors.fg, align: startAlign });
    rows.forEach((row, index) => {
      const rowTop = top + CARD_HEAD + index * rowHeight;
      if (index > 0) {
        ctx.fillStyle = colors.line;
        ctx.fillRect(left + inner, rowTop, right - left - inner * 2, 2);
      }
      const labelY = row.detail ? rowTop + 44 : rowTop + rowHeight / 2 + 12;
      drawText(ctx, row.label, start, labelY, {
        font: `500 32px ${UI}`,
        color: colors.fg,
        align: startAlign,
        maxWidth: (right - left) * 0.55,
      });
      if (row.detail) {
        drawText(ctx, row.detail, start, rowTop + 80, {
          font: `400 24px ${UI}`,
          color: colors.muted,
          align: startAlign,
        });
      }
      drawText(ctx, row.value, end, rowTop + rowHeight / 2 + 12, {
        font: `600 34px ${DISPLAY}`,
        color: colors.fg,
        align: endAlign,
      });
    });
  };

  y += TILE * 2 + 24 + GAP;
  listCard(y, paymentsHeight, data.paymentsTitle, data.payments, ROW);
  y += paymentsHeight + GAP;
  listCard(
    y,
    peopleHeight,
    data.peopleTitle,
    data.people.map((person) => ({
      label: person.name.replace(/^\d+-/, ''),
      detail: person.detail,
      value: person.value,
    })),
    PERSON_ROW,
  );
  y += peopleHeight;

  drawText(ctx, data.footer, WIDTH / 2, y + 64, { font: `500 26px ${UI}`, color: colors.muted, align: 'center' });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PHOTO_FAILED'))), 'image/png');
  });
}
