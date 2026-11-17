import { describe, expect, it } from 'vitest';
import { findStaffColumns, isActiveStatus, prepareStaffImport, readItemCodes, readStaffRows } from '../src/index.ts';

const BRANCHES = ['OCT', 'CST', 'ALX2'];

describe('staff sheet', () => {
  it('finds the columns by header, status optional', () => {
    expect(findStaffColumns(['Employee', 'Branch', 'Status'])).toEqual({ name: 0, branch: 1, status: 2 });
    expect(findStaffColumns([' branch code ', 'Employee Name'])).toEqual({ name: 1, branch: 0, status: -1 });
    expect(findStaffColumns(['Name'])).toEqual({ missing: ['branch'] });
  });

  it('cleans names and codes, merges repeats and keeps several branches per person', () => {
    const rows = readStaffRows(
      [
        ['Employee', 'Branch', 'Status'],
        ['  1234-ahmed   mohamed ', 'oct', 'Active'],
        ['1234-AHMED MOHAMED', 'OCT', ''],
        ['1234-AHMED MOHAMED', 'cst', null],
        ['1235-SARA HASSAN', 'OCT', 'Left'],
        ['1235-SARA HASSAN', 'OCT', 'Active'],
        [null, null, null],
      ],
      { name: 0, branch: 1, status: 2 },
    );
    const result = prepareStaffImport(rows, BRANCHES);
    expect(result.rows).toEqual([
      { name: '1234-AHMED MOHAMED', branch: 'OCT', active: true },
      { name: '1234-AHMED MOHAMED', branch: 'CST', active: true },
      { name: '1235-SARA HASSAN', branch: 'OCT', active: true },
    ]);
    expect(result.people).toBe(2);
    expect(result.leaving).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it('marks people whose rows are all Left as leaving; a Left row needs no branch', () => {
    const result = prepareStaffImport(
      [
        { name: '1236-OMAR SAMIR', branch: '', status: 'Left' },
        { name: '1237-MONA ALI', branch: 'ALX2', status: 'ساب' },
      ],
      BRANCHES,
    );
    expect(result.leaving).toEqual(['1236-OMAR SAMIR', '1237-MONA ALI']);
    expect(result.invalid).toEqual([]);
  });

  it('reports unknown branches and active rows without a branch', () => {
    const result = prepareStaffImport(
      [
        { name: '1238-HANY', branch: 'XYZ' },
        { name: '1239-NOUR', branch: '' },
        { name: '', branch: 'OCT' },
      ],
      BRANCHES,
    );
    expect(result.unknownBranches).toEqual(['XYZ']);
    expect(result.invalid).toEqual(['1239-NOUR', '(OCT)']);
  });

  it('reads Arabic and English status words', () => {
    expect(isActiveStatus(undefined)).toBe(true);
    expect(isActiveStatus('Active')).toBe(true);
    expect(isActiveStatus('شغال')).toBe(true);
    expect(isActiveStatus(' LEFT ')).toBe(false);
    expect(isActiveStatus('مستقيل')).toBe(false);
  });
});

describe('item code sheet', () => {
  it('reads the Item Code column and turns barcodes into item codes', () => {
    expect(
      readItemCodes([
        ['Item Code', 'Note'],
        ['r219822', 'linen'],
        ['O178475-One Size', null],
        ['R219822-L', null],
        [null, null],
      ]),
    ).toEqual(['R219822', 'O178475']);
  });

  it('reads the first column when there is no header', () => {
    expect(readItemCodes([['R219822'], ['A100200']])).toEqual(['R219822', 'A100200']);
  });
});
