# Sync Setup Guide (Google Drive + Apps Script)

This portal is hosted on a **public** GitHub Pages repository, so **no Web App URL, student code, teacher key, Drive folder ID, or student data is ever committed to GitHub**.

All synced data lives privately in **your Google Drive** via a small Google Apps Script under your Google account.

---

## 1. Create the Apps Script project (once, ~5 minutes)

1. Go to [script.google.com](https://script.google.com/) (signed in with your personal `@gmail.com` account — Workspace accounts sometimes restrict "Anyone" Web App access).
2. Click **New project** and rename it to `HSC Study Portal Sync`.
3. Delete the placeholder `myFunction` in `Code.gs` and paste the entire contents of `sync/apps-script.gs`.
4. Click **Save** (`Ctrl+S` / `Cmd+S`).

## 2. Run `initSetup` once

1. In the toolbar function dropdown, select **`initSetup`** and click **Run**.
2. Google will ask for Drive permissions and show *"Google hasn't verified this app"*:
   - Click **Advanced** → **Go to HSC Study Portal Sync (unsafe)** → **Allow**.
3. Open the **Execution log** at the bottom and copy:
   - `Generated STUDENT_CODE` (for the student's phone/tablet)
   - `TEACHER_KEY` (for your parent/teacher dashboard)
   - `FOLDER_ID` (your new private `HSC-Study-Portal-Sync` folder in Google Drive)

> Tip: You can inspect or edit these anytime under **Project Settings → Script Properties** (`STUDENTS_JSON`, `TEACHER_KEY`, `FOLDER_ID`, `TIMEZONE`).

## 3. Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to *Select type* → **Web app**.
3. Set:
   - **Description**: `v1`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
4. Click **Deploy** and copy the **Web app URL**.
   - It **must** look like `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`.
   - Do **not** use a `/dev` URL or a `/macros/u/1/` multi-account URL.

> **When updating `apps-script.gs` later**: always use **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy** so your `/exec` URL stays the same.

## 4. Link devices (without losing existing progress)

### Student's Phone (device already in use)
1. Open the portal → tap **Sync** in the top bar (or go to `#/sync`).
2. Paste the **Web app URL** and **Student code**, then tap **Save & Sync**.
3. Your child's existing `localStorage` progress is preserved and uploaded to Drive immediately.

### Student's Tablet (second device)
- On the already-linked phone, open `#/sync` and tap **Copy setup link for another device**, then send it privately (e.g. WhatsApp/Messages) to the tablet and open it.
- The portal automatically saves the credentials locally, **scrubs the URL bar**, pulls all progress from Drive, and merges cleanly.

### Parent / Teacher View
1. On your phone or laptop, open:
   ```text
   https://bhushansbaviskar.github.io/hsc-study-portal/#/teacher
   ```
2. Paste the **Web app URL** and **Teacher key**, then tap **Connect**.
3. Bookmark `#/teacher` — your key is saved on your device only (and you can sign out anytime).

## 5. Optional: Live Google Sheet summary

If you also want a live summary table in Google Sheets:
1. Create a blank Google Sheet in your Drive and copy its ID from the URL (`https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`).
2. In Apps Script **Project Settings → Script Properties**, add `SHEET_ID` = `<SHEET_ID>`.
3. Every student sync will automatically update a `Live Status` tab (non-fatal: even if the sheet is moved or deleted, Drive JSON sync keeps working).

## 6. Rotating codes or adding another student later

- Open Apps Script **Project Settings → Script Properties** → edit `STUDENTS_JSON`:
  ```json
  {
    "<STRONG_RANDOM_CODE_1>": { "id": "student1", "name": "Student 1" },
    "<STRONG_RANDOM_CODE_2>": { "id": "student2", "name": "Student 2" }
  }
  ```
- No redeployment is needed after changing Script Properties.
