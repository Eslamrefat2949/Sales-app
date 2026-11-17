import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/browser';
import { downloadBlob } from '../lib/files.ts';

/**
 * Templates for every sheet the admin uploads, each with a second "How to" sheet. The column names
 * are the ones the app reads, so a filled template always uploads.
 */
export type TemplateKind = 'items' | 'noDiscount' | 'staff';

const bold = (values: readonly string[]): Row => values.map((value) => ({ value, fontWeight: 'bold' as const }));
const notes = (lines: readonly string[]): SheetData => lines.map((line) => [line]);

const TEMPLATES: Readonly<
  Record<
    TemplateKind,
    { fileName: string; header: readonly string[]; examples: Row[]; widths: number[]; how: string[] }
  >
> = {
  items: {
    fileName: 'RAVIN Sales - Item list template.xlsx',
    header: ['Internal Reference', 'Name', 'SIZE', 'Original Sales Price (MSRP)', 'Sales Price'],
    examples: [
      ['R219822-L', 'Linen shirt', 'L', 1999.99, 1399.99],
      ['R219822-XL', 'Linen shirt', 'XL', 1999.99, 1399.99],
      ['O178475-One Size', 'Leather belt', 'One Size', 899, 899],
    ],
    widths: [24, 32, 12, 28, 14],
    how: [
      'Item list (Product Variant export from Odoo)',
      'Internal Reference = the barcode on the tag: ITEMCODE-SIZE, exactly as in Odoo.',
      'Original Sales Price (MSRP) = price before. Sales Price = price after (the price on the system).',
      'The 30% (or the offer) is applied by the app on the Sales Price.',
      'New barcodes are added, changed prices are updated, nothing is deleted.',
      'Rows without a Sales Price and barcodes that appear twice are left out and listed before upload.',
      'شيت الأصناف: نفس تصدير Product Variant من أودو. السعر قبل = MSRP، والسعر بعد = Sales Price.',
    ],
  },
  noDiscount: {
    fileName: 'RAVIN Sales - No discount items template.xlsx',
    header: ['Item Code'],
    examples: [['R219822'], ['O178475']],
    widths: [20],
    how: [
      'Items without discount',
      'One item code per row (the part before the dash). A full barcode such as R219822-L also works.',
      'Upload it, then tap "Remove discount" (or "Give discount back" to undo).',
      'These items sell at the price after, with no 30% and outside the offer.',
      'أصناف من غير خصم: كود الصنف في كل سطر، وبعد الرفع اضغط "شيل الخصم".',
    ],
  },
  staff: {
    fileName: 'RAVIN Sales - Staff template.xlsx',
    header: ['Employee', 'Branch', 'Status'],
    examples: [
      ['1234-AHMED MOHAMED ALI', 'OCT', 'Active'],
      ['1234-AHMED MOHAMED ALI', 'CST', 'Active'],
      ['1235-SARA HASSAN IBRAHIM', 'OCT', 'Active'],
      ['1236-OMAR SAMIR', '', 'Left'],
    ],
    widths: [40, 12, 12],
    how: [
      'Sales people per branch',
      'Employee = the name exactly as in Odoo (it goes in the salesperson column of the Odoo sheet).',
      'Branch = branch code (OCT, CST, ALX2…). One row per person per branch.',
      'Status = Active, or Left for someone who left the company (Left needs no branch).',
      'For every person in the sheet, the branches listed become their branches; other branches are switched off.',
      'People who are not in the sheet stay as they are. Tip: download the current staff, edit, upload.',
      'الموظفين: اسم الموظف زي أودو بالظبط + كود الفرع. اللي ساب اكتب قدامه Left.',
    ],
  },
};

function sheetsFor(kind: TemplateKind, rows?: readonly Row[]) {
  const template = TEMPLATES[kind];
  return [
    {
      data: [bold(template.header), ...(rows ?? template.examples)] as SheetData,
      sheet: 'Upload',
      columns: template.widths.map((width) => ({ width })),
    },
    { data: notes(template.how), sheet: 'How to', columns: [{ width: 110 }] },
  ];
}

/** Downloads the template; with rows, the template is filled with them (e.g. the current staff). */
export async function downloadTemplate(kind: TemplateKind, rows?: readonly Row[], fileName?: string): Promise<void> {
  const blob = await writeXlsxFile(sheetsFor(kind, rows)).toBlob();
  downloadBlob(blob, fileName ?? TEMPLATES[kind].fileName);
}
