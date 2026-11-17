import { assertMoney, type Money } from './money.ts';

export type PaymentKind = 'cash' | 'card' | 'other';

export interface PaymentMethod {
  readonly code: string;
  readonly kind: PaymentKind;
}

export interface PaymentLine {
  readonly methodCode: string;
  readonly amount: Money;
}

export type PaymentSettlement =
  | {
      readonly ok: true;
      /** Amounts as recorded on the invoice; they always add up to the invoice total exactly. */
      readonly payments: readonly PaymentLine[];
      /** Cash handed back to the customer. */
      readonly change: Money;
      /** Total amount the customer handed over. */
      readonly tendered: Money;
    }
  | {
      readonly ok: false;
      readonly reason: 'UNDERPAID' | 'OVERPAID_WITHOUT_CASH' | 'UNKNOWN_METHOD';
      /** Still to collect (UNDERPAID) or too much on non-cash methods (OVERPAID_WITHOUT_CASH). */
      readonly difference: Money;
    };

/**
 * Validates a split payment against the invoice total.
 * Only cash can exceed the total: the excess becomes change and is deducted from the recorded cash,
 * so the recorded payments always equal the total. Card and other methods must be exact.
 */
export function settlePayments(
  total: Money,
  tendered: readonly PaymentLine[],
  methods: readonly PaymentMethod[],
): PaymentSettlement {
  assertMoney(total, 'total');
  const kindByCode = new Map(methods.map((method) => [method.code, method.kind]));
  const lines = tendered.filter((line) => line.amount > 0);
  for (const line of lines) {
    assertMoney(line.amount, `amount for ${line.methodCode}`);
    if (!kindByCode.has(line.methodCode)) return { ok: false, reason: 'UNKNOWN_METHOD', difference: 0 };
  }

  const tenderedTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  if (tenderedTotal < total) return { ok: false, reason: 'UNDERPAID', difference: total - tenderedTotal };

  const excess = tenderedTotal - total;
  const cashTotal = lines
    .filter((line) => kindByCode.get(line.methodCode) === 'cash')
    .reduce((sum, line) => sum + line.amount, 0);
  if (excess > cashTotal) return { ok: false, reason: 'OVERPAID_WITHOUT_CASH', difference: excess - cashTotal };

  // Deduct the change from cash lines, last one first.
  let changeLeft = excess;
  const recorded = [...lines];
  for (let index = recorded.length - 1; index >= 0 && changeLeft > 0; index -= 1) {
    const line = recorded[index]!;
    if (kindByCode.get(line.methodCode) !== 'cash') continue;
    const deduction = Math.min(line.amount, changeLeft);
    recorded[index] = { ...line, amount: line.amount - deduction };
    changeLeft -= deduction;
  }

  return {
    ok: true,
    payments: recorded.filter((line) => line.amount > 0),
    change: excess,
    tendered: tenderedTotal,
  };
}
