import { normalizeDigits } from './text.ts';

/**
 * The staff sheet the admin uploads: one row per sales person per branch.
 * Columns: Employee (the name exactly as in Odoo, e.g. "9756-EZZ ELDIN EHAB IBRAHIM"), Branch (code,
 * e.g. OCT) and an optional Status (Active / Left).
 */
export interface StaffSourceRow {
  readonly name: unknown;
  readonly branch: unknown;
  readonly status?: unknown;
}

export interface StaffRow {
  readonly name: string;
  /** Branch code in capitals; empty only on a "Left" row. */
  readonly branch: string;
  readonly active: boolean;
}

export interface StaffImport {
  readonly rows: readonly StaffRow[];
  /** Different people in the sheet. */
  readonly people: number;
  /** People whose rows are all "Left": they disappear from every branch. */
  readonly leaving: readonly string[];
  /** Branch codes that do not exist; the upload is blocked until they are fixed. */
  readonly unknownBranches: readonly string[];
  /** Active rows without a branch, or rows without a name. */
  readonly invalid: readonly string[];
}

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : normalizeDigits(String(value)).replace(/\s+/g, ' ').trim();

const LEFT_WORDS = new Set([
  'left',
  'leave',
  'resigned',
  'inactive',
  'no',
  'false',
  '0',
  'x',
  'ساب',
  'سابت',
  'مستقيل',
  'مستقيلة',
  'استقال',
  'مش شغال',
  'لا',
]);

/** Blank means active; "Left", "No", "ساب"… mean the person no longer works in the company. */
export function isActiveStatus(value: unknown): boolean {
  return !LEFT_WORDS.has(text(value).toLowerCase());
}

/**
 * Cleans the staff sheet. Repeated rows are merged (an active row wins over a "Left" row for the
 * same person and branch). Names are compared in capitals, like Odoo exports them.
 */
export function prepareStaffImport(rows: readonly StaffSourceRow[], branchCodes: Iterable<string>): StaffImport {
  const known = new Set([...branchCodes].map((code) => code.toUpperCase()));
  const byKey = new Map<string, StaffRow>();
  const invalid: string[] = [];
  const unknown = new Set<string>();

  for (const source of rows) {
    const name = text(source.name).toUpperCase();
    const branch = text(source.branch).toUpperCase();
    const active = isActiveStatus(source.status);
    if (name === '' && branch === '') continue;
    if (name === '' || (active && branch === '')) {
      invalid.push(name || `(${branch})`);
      continue;
    }
    if (branch !== '' && !known.has(branch)) unknown.add(branch);
    const key = `${name}\u0000${branch}`;
    const previous = byKey.get(key);
    byKey.set(key, { name, branch, active: active || (previous?.active ?? false) });
  }

  const cleaned = [...byKey.values()];
  const people = new Map<string, boolean>();
  for (const row of cleaned) people.set(row.name, (people.get(row.name) ?? false) || row.active);
  return {
    rows: cleaned,
    people: people.size,
    leaving: [...people].filter(([, active]) => !active).map(([name]) => name),
    unknownBranches: [...unknown].sort(),
    invalid,
  };
}

const HEADERS: Readonly<Record<keyof StaffSourceRow, readonly string[]>> = {
  name: ['employee', 'employee name', 'name', 'sales person', 'salesperson', 'الموظف', 'اسم الموظف', 'السيلز بيرسون'],
  branch: ['branch', 'branch code', 'code', 'الفرع', 'كود الفرع'],
  status: ['status', 'active', 'الحالة'],
};

export type StaffColumns = { readonly [K in keyof StaffSourceRow]-?: number };

/** Finds the staff columns by their headers; status is optional. */
export function findStaffColumns(header: readonly unknown[]): StaffColumns | { readonly missing: string[] } {
  const names = header.map((value) => text(value).toLowerCase());
  const find = (key: keyof StaffSourceRow) => names.findIndex((name) => HEADERS[key].includes(name));
  const columns = { name: find('name'), branch: find('branch'), status: find('status') };
  const missing = (['name', 'branch'] as const).filter((key) => columns[key] < 0).map((key) => HEADERS[key][0]!);
  return missing.length > 0 ? { missing } : columns;
}

export function readStaffRows(rows: readonly (readonly unknown[])[], columns: StaffColumns): StaffSourceRow[] {
  return rows.slice(1).map((row) => ({
    name: row[columns.name],
    branch: row[columns.branch],
    status: columns.status >= 0 ? row[columns.status] : undefined,
  }));
}

/**
 * Reads item codes from a one-column sheet (the "no discount" list). Takes the "Item Code" column
 * when there is a header, otherwise the first column; full barcodes (R219822-L) become item codes.
 */
export function readItemCodes(rows: readonly (readonly unknown[])[]): string[] {
  const header = (rows[0] ?? []).map((value) => text(value).toLowerCase());
  const named = header.findIndex((name) => ['item code', 'code', 'item', 'كود الصنف', 'الكود'].includes(name));
  const column = named >= 0 ? named : 0;
  const body = named >= 0 || /[a-z]{3,}/i.test(header[0] ?? '') ? rows.slice(1) : rows;
  const codes = body
    .map((row) => text(row[column]).toUpperCase())
    .filter((code) => code !== '')
    .map((code) => {
      const dash = code.indexOf('-');
      return dash > 0 ? code.slice(0, dash) : code;
    });
  return [...new Set(codes)];
}
