# Business Rules

Single source of truth for how the RAVIN Sales App behaves. Every rule here is confirmed by the
business owner unless it is marked **OPEN** or **PROPOSED**. Code that implements a rule links back
to its section.

## 1. Purpose

A mobile-first "line-busting" POS used by all 33 branches during traffic peaks so the cashier line
stays short. Sales are captured on phones (desktop also supported), and each branch exports its sales
every night and imports the file into Odoo. Odoo stays the system of record.

## 2. Prices

- Each sellable variant is an **item code + size**, with two prices from Odoo:
  - **List price** ("before"): the original price.
  - **Sale price** ("after"): the current selling price. Every discount is calculated from this price.
- **Default discount:** an extra **30%** on the sale price of every piece that is not in an offer.
  The percentage is a setting the admin can change without a code change.
- Money is stored as integer piasters. Percentage discounts round half-up to the nearest piaster
  (799.00 at 30% = 559.30). **OPEN:** should final prices be rounded to whole pounds?

Implemented in `packages/domain/src/pricing.ts` and `money.ts`.

## 3. Offer: buy X pay Y (currently buy 4 pay 2)

- Applies to **all items**. The seller **activates it manually** on the cart.
- Pieces are sorted from most to least expensive (by sale price). For every complete group of 4:
  the 2 most expensive are **paid at the sale price, without the extra 30%**, and the next 2 are
  **free**. Pieces left over (always the cheapest) get the default 30%.

| Pieces | Paid (sale price) | Free | Default 30% |
| ------ | ----------------- | ---- | ----------- |
| 4      | #1 #2             | #3 #4 | none       |
| 5      | #1 #2             | #3 #4 | #5         |
| 7      | #1 #2             | #3 #4 | #5 #6 #7   |
| 8      | #1 to #4          | #5 to #8 | none    |

Worked example (sale prices 1000, 800, 600, 400, 300): 1000 + 800 + 0 + 0 + 210 = **2,010**.
Without the offer the same cart costs 2,170.

- Pieces **added after** the offer was activated get the default 30% and do **not** reshuffle the offer.
- **PROPOSED:** activating the offer again recalculates it over the whole cart, including the newer pieces.
- **PROPOSED:** removing a piece that was part of the offer cancels the offer; the whole cart returns to
  the default 30% until the seller activates it again (prevents removing a paid piece and keeping the free ones).
- Because paid pieces carry no extra discount, the offer can cost **more** than the default 30%
  (1000, 900, 150, 150 → 1,900 with the offer vs 1,540 without). Before activating, the app shows
  both totals side by side.

Implemented in `packages/domain/src/offer.ts`, `pricing.ts` and `cart.ts`.

## 4. Adding items to the cart

- **Manual entry is the main method** because many pieces have no barcode.
  - Item codes are one letter followed by digits (e.g. `A12345`). The phone opens the **numeric
    keypad**; typing the digits alone finds the item.
  - Results appear while typing, from the catalog stored on the phone (works offline).
  - Selecting an item shows **all sizes of that item** (no stock filter) as large buttons; tapping a
    size adds one piece, tapping again adds another.
- **Camera scanning** is available for pieces that have a barcode. Barcode format is `ITEMCODE-SIZE`;
  lookup matches the full barcode exactly (never split on the dash).

Search and size ordering are implemented in `packages/domain/src/catalog.ts`.

## 5. Invoice

- **Sales person:** chosen on every invoice from the employee list (branch employees first, search
  across all). Defaults to the last sales person chosen on that phone.
- **Customer:** mobile number and name; a known number fills in the name.
- **Payment:** the payment methods enabled for that branch; one invoice can be split across methods;
  change is calculated for cash.
- **Invoice number:** `{BRANCH}-M{device}-{sequence}`, e.g. `ABC-M2-00042`. Each phone gets its own
  device number the first time it is set up and counts its invoices locally, so numbers are unique even
  offline and can never clash with Odoo's own POS numbers. A reset phone always gets a new device number.
  Final format will follow the Odoo upload form.
- The confirmation screen shows the invoice number in large type so the customer can photograph it.
  Nothing is sent to the customer.

## 6. Voids (returns)

- There is **no exchange flow**. A return voids the whole invoice; if the customer wants something
  else, the seller rings up a new invoice.
- Any seller can void, on the same day and before the invoice is exported. A reason is required.
- A voided invoice is excluded from the export and from sales totals, but stays in the database and
  appears in the summary with its details (count and value per seller and per branch).
- Voided numbers are never reused.

## 7. Offline operation

- The app must keep selling without internet. The catalog, prices, offers, employees and payment
  methods are stored on the phone.
- Every invoice is saved on the phone first and sent to the server automatically as soon as there is a
  connection. A status indicator shows how many invoices are waiting.
- The server re-prices every synced invoice with the same pricing code and flags any difference for
  review.
- First sign-in on a phone requires internet.
- Risk: unsynced invoices exist only on that phone. The admin panel shows each phone's last sync time.

## 8. Reports

Available at any time (mid-day or end of day), per **sales person** and per **phone** (cash is held
by whoever holds the phone), plus the branch total:

- Invoice count, pieces, total sales, average invoice value, pieces per invoice
- Total per payment method (cash, card, ...)
- Voided invoices: count and value
- Share as text (e.g. WhatsApp to the branch manager)

## 9. Export to Odoo

- Each branch downloads a file in the exact Odoo import format. **OPEN:** waiting for the upload form.
- The export contains **every synced invoice not yet exported**, not just "today", so an invoice that
  syncs late is picked up by the next export instead of being lost.
- Each download is recorded as a batch (who, when, how many invoices). Exported invoices are locked.
- Downloading again warns that the batch was already downloaded, to prevent a double import.
- Before downloading, the screen warns if any phone of the branch still has unsynced invoices.

## 10. Admin panel

- Live dashboard: sales per branch, per hour and per sales person
- Invoice search and details, including voids
- Branches, branch passwords, payment methods per branch
- Catalog and price upload (from Odoo export), employees, offers, default discount
- Audit log

## 11. Users and access

- Each branch signs in with its own branch account and password. Several phones (2 to 3 sellers)
  can use the same branch account at the same time.
- Admins see every branch. **PROPOSED:** an area manager role that sees only their branches.

## 12. Interface

- Arabic and English, switchable from a button at the top; right-to-left layout for Arabic. The
  phone remembers the choice.

## 13. Infrastructure

- A dedicated Supabase project named **RAVIN SALES APP**, separate from the existing projects.
- **OPEN:** the free plan allows two active projects and both are in use. The owner will free a slot by
  pausing or deleting an unused project, then the new project is created on the free plan. Before the
  rollout to all branches, revisit the Pro plan for daily backups.

## Open items

1. Odoo upload form (ideally with a filled example).
2. Branch names, codes and mapping.
3. Payment methods per branch and their Odoo names.
4. Item list from Odoo (item code, name, size, barcode if any, list price, sale price). No branch stock.
5. Employee list (name, branch, name as in Odoo).
6. Final price rounding (piasters or whole pounds).
7. Free a Supabase project slot (pause or delete an unused project).
