# Shorts Guard — Google Sheets sync (set up once, ~5 minutes)

This lets the extension push your notes and pass usage to a Google Sheet, so the
weekly analysis can read it automatically — no exporting or attaching files.

## 1. Make the sheet

- Go to https://sheets.new to create a blank spreadsheet.
- Name it **Shorts Guard Log**.

## 2. Add the script

- In that sheet: **Extensions → Apps Script**.
- Delete whatever is in the editor and paste the contents of **Code.gs**.
- Click **Save** (the disk icon).

## 3. Deploy it as a web app

- Click **Deploy → New deployment**.
- Click the gear/select type → **Web app**.
- Set:
  - **Execute as:** Me
  - **Who has access:** Anyone
- Click **Deploy**, then **Authorize access** and approve (it only writes to this
  one spreadsheet).
- Copy the **Web app URL** it gives you (ends in `/exec`).

## 4. Put the URL in the extension

- Open the Shorts Guard popup → paste the URL into **Sync webhook URL** → **Save**.

From now on every note you save and every Traction pass appends a row to the
sheet's "Log" tab. To check it's working, use a Short and then refresh the sheet.

## 5. Let the weekly job read it

- Authorize the Google account that owns this sheet when prompted (see the chat
  message), so the Saturday analysis can read the "Log" tab.

## Notes

- If you ever redeploy, you get a new URL — update it in the extension.
- The sheet is in **your** Google account; only you and the account you authorized
  can read it.
- To stop syncing, just clear the **Sync webhook URL** in the popup.
