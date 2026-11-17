# Business Rules

Single source of truth for how the RAVIN Sales App behaves. Every rule here is confirmed by the
business owner unless it is marked **OPEN** or **PROPOSED**. Code that implements a rule links back
to its section.

## 1. Purpose

A mobile-first "line-busting" POS used by all 33 branches during traffic peaks so the cashier line
stays short. Sales are captured on phones (desktop also supported), and each branch exports its sales
every night and imports the file into Odoo with the **POS Import** module. Odoo stays the system of record.

## 2. Users and access

| Who                     | Signs in with                       | Can do                                                                                                                                   |
| ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Admin                   | email + password                    | Everything, all branches: dashboard, items and prices, offers, payment methods, employees, branch passwords, phones, voids and audit log |
| Area manager (PROPOSED) | email + password                    | Dashboard and invoices for their own branches only; no price changes                                                                     |
| Branch                  | branch code (e.g. `ARB`) + password | Sell, today's report, void, download the Odoo file, for its own branch only                                                              |

- One account per branch (33). Several phones can use the same branch account at the same time.
- A phone signs in once (internet needed the first time) and stays signed in, including offline.
- The admin sets and resets branch passwords. A reset signs out every phone of that branch at its next
  connection (for when staff leave).
- Each phone is registered under its branch at first sign-in. The admin sees every phone, its last
  sync and its pending invoices, and can block a lost phone.
- **Sales people are not users.** They are picked on each invoice (section 6).

## 3. Branches

33 branches from the `PAYMENT` sheet. For each: branch code (`LOC`, e.g. `ARB`), Point of Sale name
(`Mall of Arabia`) and Odoo branch (`BRANCHES - MALL OF ARABIA`). The branch code is the sign-in name
and the prefix of every invoice number. **OPEN:** branch `OCT` uses `OCT2` in its journal names; the
invoice prefix uses `OCT` unless told otherwise.

## 4. Payment methods

- 15 methods, all enabled in all 33 branches: VISA BM, Rise, Tru, Sales Value, Sympl Sales, Premium Card
  Under Collection, Sales_Contact, Souhoola Sales, VISA AAIB, VISA Ahly, VISA QNB, Paymob Visa, Mylo,
  Seven, Cash Store.
- The Odoo journal is stored per branch exactly as in the sheet: `<method> - <branch>`, e.g.
  `VISA BM - ARB` (no `12` prefix).
- Only **Cash Store** is cash: it may exceed the total and the excess is given back as change. Every other
  method must be exact.
- One invoice can be split across several methods.
- The admin can hide a method for a branch and set the display order (most used first).
- **OPEN:** Aman Sales, We Vouchers and WePoint appear in Odoo orders but not in the sheet.

## 5. Items and prices

- The admin uploads the item list (Excel). Per size: barcode exactly as in Odoo (`R219822-L`,
  `O178475-One Size`), item code, name, size, price before (list price), price after (sale price), and
  whether the item takes discounts. Phones update automatically when online.
- **Default discount:** an extra **30%** on the price after, for every piece not in an offer. The admin can
  change the percentage.
- **Items without discount:** the admin marks them; they are sold at the price after.
  **OPEN:** they also stay out of the buy 4 pay 2 offer (proposed).
- **Rounding like Odoo:** each line's discount is calculated exactly and the invoice total is rounded once to
  the piaster. Checked against 63 real cashier orders: 46 match to the piaster; the rest are exchanges, partial
  payments or special cases. Rounding per line instead would be off by 0.01 on some orders
  (1,499.99 + 1,199.99 at 30% = 1,889.99, not 1,889.98).

Implemented in `packages/domain/src/pricing.ts` and `money.ts`.

### Offer: buy X pay Y (currently buy 4 pay 2)

- The seller **activates it manually** on the cart.
- Pieces are sorted from most to least expensive (by price after). For every complete group of 4:
  the 2 most expensive are **paid at the price after, without the 30%**, and the next 2 are **free**.
  Pieces left over (always the cheapest) get the default 30%.

| Pieces | Paid (price after) | Free     | Default 30% |
| ------ | ------------------ | -------- | ----------- |
| 4      | #1 #2              | #3 #4    | none        |
| 5      | #1 #2              | #3 #4    | #5          |
| 7      | #1 #2              | #3 #4    | #5 #6 #7    |
| 8      | #1 to #4           | #5 to #8 | none        |

Worked example (prices after 1000, 800, 600, 400, 300): 1000 + 800 + 0 + 0 + 210 = **2,010**.

- Pieces **added after** the offer was activated get the default 30% and do not reshuffle the offer.
- **PROPOSED:** activating the offer again recalculates it over the whole cart.
- **PROPOSED:** removing a piece that was part of the offer cancels the offer.
- Before activating, the app shows the total with and without the offer, because the offer can cost more
  than the 30% (1000, 900, 150, 150 → 1,900 vs 1,540).
- **OPEN:** a cashier order with 6 pieces charged the 3 most expensive and gave 3 free (Mall of Egypt
  12002172); the rule above gives 2 free and 2 at 30%.

Implemented in `packages/domain/src/offer.ts`, `pricing.ts` and `cart.ts`.

## 6. Selling

- **Adding pieces:** camera scanner, Bluetooth/USB scanner, or typing the item code and choosing the size.
  - Barcode format `ITEMCODE-SIZE`, matched exactly (never split on the dash). Spaces and letter case are
    ignored when matching, and the original barcode is kept for the export.
  - The camera stays open and scans continuously: beep, vibration and a green frame per piece; an unknown
    barcode shows the code read with a red frame. The same label is ignored while it stays in view and
    accepted again after 1.5 seconds out of view. Works offline (bundled reading engine).
  - Typing: item codes are a letter plus digits; the numeric keypad opens and typing the digits finds the
    item; all its sizes appear as large buttons.
- **Sales person:** required on every invoice, from the employee list (branch employees first, search all).
  Defaults to the last one picked on that phone.
- **Customer mobile and name: optional.** A known mobile fills in the name.
- **Invoice number:** `{BRANCH}-APP-{6 digits}`, e.g. `ARB-APP-000042`. To sell offline, each phone
  reserves a block of numbers from the server while online and refills it automatically. Numbers are
  unique and never clash with cashier numbers; they can have gaps and are not in time order across phones,
  which does not matter to Odoo.
- The confirmation screen shows the invoice number large enough to photograph. Nothing is sent to the
  customer.

## 7. Voids (returns)

- No exchange flow: a return voids the whole invoice and the seller rings up a new one.
- Any seller can void, on the same day and before export. A reason is required.
- Voided invoices are excluded from the export and from totals, but stay visible in the report with details.
- After export, returns are done in Odoo. Voided numbers are never reused.

## 8. Offline operation

- The catalog, prices, offers, employees and payment methods are stored on the phone.
- Every invoice is saved on the phone first and sent automatically when there is a connection. A status
  indicator shows how many invoices are waiting.
- The server re-prices every synced invoice with the same pricing code and flags any difference.
- Risk: unsynced invoices exist only on that phone. The admin sees each phone's last sync.

## 9. Reports

- Any time of day, per sales person, per phone (cash is held by whoever holds the phone) and per branch:
  invoices, pieces, sales, average invoice, pieces per invoice, total per payment method, voids.
- Copy as text for WhatsApp.
- Admin dashboard: all branches live, per hour, per branch, per sales person, void rate.

## 10. Export to Odoo (POS Import)

- The branch downloads an Excel file in the POS Import format: `order_ref`, `product_barcode`, `qty`,
  `date`, `partner_name`, `partner_phone`, `price_unit`, `payment_amount`, `payment_method`,
  `salesperson`, plus a discount column (**OPEN:** final column name and format, being prepared).
- **Sales only, no returns:** voided invoices are left out of the file entirely; there are never refund
  rows (`qty` -1). Once a file is downloaded its invoices are final; any later return is made in Odoo.
- One row per piece with `qty` 1. `price_unit` is the price after; the discount column carries the line
  discount (30, 0 for an offer-paid piece, 100 for a free piece).
- Order fields (`date`, customer, `salesperson`) on the first row of each order; each payment on its own
  row (first payment on the first row, further payments on the following rows).
- `order_ref` is the invoice number (`ARB-APP-000042`). `payment_method` is the branch journal
  (`VISA BM - ARB`). `salesperson` is the name exactly as in the sheet (`9173-HABIBA ...`).
- The export contains every synced invoice not exported yet, so late invoices are never lost. Each
  download is recorded; a repeat download warns about double import; the screen warns if a phone still
  has unsynced invoices.
- **OPEN:** confirm with a test import that the order lands in the right branch with this `order_ref`,
  and that an empty customer is accepted.

## 11. Interface

- Arabic and English, switchable from a button at the top; right-to-left layout for Arabic.

## 12. Infrastructure

- App hosted on Cloudflare Pages, deployed automatically from the GitHub repository.
- Supabase project **RAVIN SALES APP** (Frankfurt), free plan for development and the pilot; move to Pro
  (daily backups) before the rollout to all branches.

## Data quality notes (employees sheet)

- `8143` and `9346` are listed twice in MNS2: duplicates are removed on import.
- Five employees appear in two branches (`8610`, `7990`, `8551`, `8590`, `8937`): **PROPOSED** they appear
  in both branches.

## Pilot decisions (17 Nov 2026)

- **Sign-in:** pick the branch (or the admin name) from a list and type a 6-digit PIN on an on-screen
  keypad. Five wrong PINs lock the account for 15 minutes. All four admins (Eslam Refat, Sameh Ahmed,
  Mohamed Yousef, Ahmed Hamdy) have full rights and see every branch. Admins change any PIN from the
  app; a change signs out that account's phones.
- **Offer or 30% is the seller's choice** with the customer: the offer sheet shows both totals and
  nothing changes until the seller taps Apply. Pieces inside the offer never take the 30%.
- **Scanner:** scan, the camera pauses and shows the piece (code, size, prices, price after 30%),
  the seller taps Done (or Skip), the camera resumes for the next piece. The screen stays awake.
- **Cart:** the same piece priced the same way is one line with a count and +/- buttons.
- **Close of day:** the report shows sales since the last close. "Close the day" locks every invoice
  not closed yet into a batch, downloads the Odoo sheet and starts the count from zero. Every close is
  kept in a history and can be downloaded again (each repeat is counted and warns about double import).
- **Several phones on one branch account** sell at the same time without conflict: each phone uses its
  own reserved invoice numbers.
- **Design:** bright blue, friendly style following the owner's reference mock-ups (gradient header,
  white rounded cards, pastel stat tiles, light motion).
- A test branch `TST` was used for training and testing; it is switched off for go-live.

## Go-live decisions (18 Nov 2026)

- **All 33 branches** sign in from the list with their own 6-digit PIN (handed out by the admins,
  changeable in Management > PINs). Admin names show as "Mr ESLAM REFAT", "Mr SAMEH AHMED",
  "Mr MOHAMED YOUSEF", "Mr AHMED HAMDY".
- **Sales people are per branch.** A branch only receives and only can read its own staff (enforced
  by the server, not just hidden in the screen). Admins see everyone. Someone moved to another branch
  still shows on the old branch's past invoices and sheets.
- **Staff upload (Management > Staff):** a sheet with Employee (name exactly as in Odoo), Branch (code)
  and Status (Active / Left), one row per person per branch. For every person in the sheet, the listed
  branches become their branches and other links are switched off; "Left" removes them from every
  branch; people not in the sheet are not touched. Unknown branch codes block the upload. "Current
  staff" downloads today's list in the same layout to edit and upload back.
- **Templates:** every sheet the app accepts (item list, items without discount, staff) has a
  "Template" button with an example and a "How to" tab. The items-without-discount list can also be
  uploaded as a sheet (Item Code column; full barcodes are cut to the item code).
- **Sheet name:** the Odoo sheet is named after the branch and the day it sold, e.g.
  `OCT - 6th of October Outlet Mall - 2026-11-18.xlsx` (a range when late invoices from an earlier day
  are in the same close).
- **Closing register:** closing the day downloads the sheet and opens the closing photo with a clear
  "save this photo" prompt: branch, sale date, close time, total, invoices, pieces, average, voids since
  the previous close, each payment method and each sales person. "Save the photo" stores it on the
  phone (on iPhone through the share sheet's "Save Image"); "Share" sends it on WhatsApp. Every earlier
  close in the history reopens with its photo and sheet.
- **Invoice numbers never repeat and never restart** - not after a close, not the next day. The branch
  counter lives on the server and only moves forward; each phone takes a block of 100 numbers from it,
  so numbers can jump between phones (e.g. OCT-APP-000003 then OCT-APP-000101) but are never reused.
  The database also refuses a duplicate number.
- After a close the report starts again from zero, including the voided list.

## PINs and staff (18 Nov 2026, before go-live)

- **PINs are 4 to 8 digits.** Every branch starts on the temporary PIN **1234**. At the first sign-in
  the app asks the branch to choose its own PIN (typed twice) before anything else opens. Easy PINs are
  refused: 1234, one digit repeated (0000, 1111…) and straight runs (2345, 9876…).
- **Changing the PIN later:** Account menu (top of the screen) > Change PIN: current PIN, new PIN,
  new PIN again. Wrong current PINs count towards the 15-minute lock. A new PIN signs out the
  account's other phones; the phone that changed it stays signed in.
- **Forgotten PIN:** an admin taps "Back to 1234" in Management > PINs; the branch chooses a new PIN
  at its next sign-in. Admins can also set a PIN directly (then no change is forced).
- **Adding a sales person (Management > Staff):** pick the branch, type the name exactly as in Odoo
  (with the number; existing names are suggested), tap Add. Someone already in another branch is added
  to this one too. The branch's list shows everyone with a Remove button. Branch phones see the change
  the next time the app opens. The staff sheet stays for changing many people at once.

- **Admins** also start on a temporary PIN (kept privately with management, never in this repository)
  and choose their own PIN at the first sign-in. A new PIN must differ from the current one.
  "Back to temporary" in Management > PINs puts an account back on the temporary PIN of its kind.
- **Training branch `TST` ("Training Branch (تدريب)")** is for explaining the app to staff. It sells
  like a real branch with two training sales people, but it is left out of the management dashboard
  and its sheets are never imported into Odoo. Put it back on 1234 from the PINs tab before each
  training to show the first sign-in again.

## Open items

1. Items without discount: also excluded from the offer? (Today: yes, they sell at the price after.)
2. 6-piece offer case (Mall of Egypt 12002172).
3. Aman Sales, We Vouchers, WePoint.
4. Area manager role: wanted, and which branches per manager.
5. Does Odoo keep our order_ref (e.g. OCT-APP-000003) on the imported order? If not, the POS Import
   module should store it as the receipt / pos_reference.
6. Supabase Pro plan (daily backups) before all branches sell every day.

Resolved: the POS Import discount column works in Odoo 19; the item list is loaded; the `OCT`
invoice prefix stays `OCT` (journals use `OCT2`).
