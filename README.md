# M&M Car Clinic

Cash book, inventory and (soon) salary tracker for M&M Car Clinic.

- **Website:** plain HTML/CSS/JS, hosted on GitHub Pages (no build step).
- **Database:** a Google Sheet. A small Google Apps Script attached to the sheet is the API.

```
Phone / PC browser ──► GitHub Pages (this repo) ──► Apps Script web app ──► Google Sheet tabs
```

## What it does

| Screen | |
|---|---|
| **Daily** | Cash in / cash out / transfers for one day, opening and closing balance, closing balance by account (Cash in hand, Bank, bKash). Print gives the same layout as the old paper ledger. |
| **Monthly** | Totals for the month, expenses and income by category (click a category to see every entry), day-by-day closing, month-end balance per account, CSV download. |
| **Inventory** | Parts and consumables with stock level, low-stock warnings, stock in / out / adjust, history. Stock bought or sold can be recorded in the cash book at the same time. |
| **Salary → Attendance** | Monthly grid of employees × days. Tap a day: P present, A absent, L paid leave, O off/holiday. Weekly off days fill in automatically. |
| **Salary → Salary sheet** | Basic, present/absent days, absence deduction (worked out automatically), advance, net payable, paid, due. Advances and salary payments are recorded in the cash book too. Printable. |
| **Salary → Employees** | Add, edit or remove staff. Untick "track attendance" for heads of department, investors, or anyone paid a fixed amount. |
| **Settings** | Starting balances, payment methods, categories, business details. |

There is one **Transactions** tab instead of one tab per day. Each day's opening balance is worked out
from the starting balances plus everything before it, so nothing has to be linked by hand.

## Sheet tabs (created automatically)

| Tab | Holds |
|---|---|
| `Transactions` | Every cash in / out / transfer: date, type, invoice, description, category, amount, method |
| `Categories` | Category lists for cash in and cash out |
| `Settings` | Starting date, opening balance per account, payment methods, business details |
| `Inventory` | Items: SKU, name, category, unit, cost and sale price, reorder level |
| `StockMoves` | Every stock in / out / adjustment |
| `Employees` | Name, designation, basic salary, joining date, whether attendance is tracked |
| `Attendance` | One row per employee per marked day: date, status (P/A/H/L/O) |
| `SalaryPayments` | Advances and salary payments, which month they belong to, and the linked cash-book entry |

Please don't rename these tabs or their header row. You can read them and filter them freely.

## One-time setup

### 1. Add the script to the Google Sheet
1. Open the Google Sheet → **Extensions → Apps Script**.
2. Delete what's in `Code.gs` and paste in [`apps-script/Code.gs`](apps-script/Code.gs).
3. Click ⚙️ **Project Settings** → set the time zone to **(GMT+06:00) Dhaka**.
4. Save (💾). Go back to the sheet and reload it. A new **M&M App** menu appears.

### 2. Prepare the sheet
1. **M&M App → 1. Set up / repair tabs** (Google will ask you to allow the script the first time).
2. **M&M App → 2. Create an admin account**: your own username, name and password. You use this to sign in and approve everyone else.
3. *(Optional)* **M&M App → 4. Import old daily sheets**: copies every old "DAILY CASH FLOW LEDGER" tab into
   `Transactions`, sets the opening balances from the first day, and reads the category from the brackets
   in the description, e.g. `LUNCH (FOOD)` → Food. Your old tabs are not changed, and running it again replaces the earlier import.
4. *(Optional)* **M&M App → 5. Import employees from a salary sheet**: paste the salary sheet's link and the month.
   Employees (name, designation, basic salary) are added or updated, and the "Advance Salary Taken" amounts are
   recorded as advances for that month. Designations containing "Invest" or "Head of" are set to no absence deduction.

**How the absence deduction works:** one day's pay = basic ÷ 26 (Friday is the only weekly off).
Each **A** deducts one day. **L** (paid leave), **O** (off/holiday) and unmarked working days are not deducted.
Heads of department and investors (attendance not tracked) are never deducted.
Days before an employee's joining date are deducted. Days after today aren't counted until they happen.

### 3. Publish the script as a web app
1. In Apps Script: **Deploy → New deployment → ⚙️ → Web app**.
2. *Execute as:* **Me**. *Who has access:* **Anyone**.
3. **Deploy** and copy the **Web app URL** (ends in `/exec`).

"Anyone" means anyone with the URL can reach the script, but every request (except sign-in and sign-up)
must carry a valid session, and the script checks that user's access before reading or changing anything.
Passwords are stored only as salted hashes in the `Users` tab; nothing secret is in this repo.

After changing `Code.gs` later: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (the URL stays the same).

### 4. Open the app
Open the GitHub Pages site, paste the Web app URL, and sign in with the admin account.
To skip pasting the URL on every new device, put it in [`js/config.js`](js/config.js) and push.

## Run locally

```bash
python -m http.server 5500
```

Then open http://localhost:5500. **Try the demo** (shown only on localhost) works without a server, using made-up sample data that stays in that browser.

## Users & access

- **Sign-up and approval.** Staff choose a username and password under **Request access** on the sign-in
  screen. Their account stays *waiting for approval* until an admin approves it under **Users**.
- **Access per section.** For each person the admin sets Cash book, Monthly report, Inventory, Attendance,
  Salary sheet, Employees and Settings to **Hidden**, **View** or **View & edit**. Admins can do everything.
  The script checks this on every request, so editing the public website code doesn't get around it.
- **Salary privacy.** Basic salary and payments are only sent to people with Salary sheet or Employees access.
  Attendance-only users see days, not money.
- **Added by / edited by.** Every cash entry, stock movement, attendance mark, salary payment, item and employee
  records who added it and who last changed it.
- **Full change history.** The `ChangeLog` tab keeps every add, edit and delete with the old and new values.
  Open any entry → *History*, or see everything under **Activity** (admins).
- **Passwords.** Stored as salted HMAC-SHA256 hashes (1,000 rounds). Five wrong tries lock that username for
  15 minutes. People are signed out after 6 hours without using the app. An admin can reset a password
  (which signs that person out everywhere), or use **M&M App → 3. Reset a user's password** in the sheet.
- **Keep the Google Sheet private.** Anyone with edit access to the Sheet itself can change anything, including
  the `Users` and `ChangeLog` tabs. Give staff the app, not the Sheet.
