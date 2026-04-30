# Anonymous Peer Review Survey

A self-contained web app for anonymous peer reviews, built with **Node.js + Express** and a dependency-free vanilla JS frontend. Storage is a single JSON file — no database engine, no compilation, no Python required.

## Easy Windows setup

1. Install Node.js from [nodejs.org](https://nodejs.org) (click the big green LTS button, run the installer, accept all defaults).
2. Unzip this folder somewhere you'll remember (e.g., `C:\Users\<you>\peer-review`).
3. Double-click **`Install (first time).bat`** and wait for it to finish. Do this once.
4. Double-click **`Start app.bat`** whenever you want to use the app. It opens the admin page in your browser automatically.
5. When you're done, close the black terminal window — that stops the app.

## Manual setup (Mac / Linux / command line)

```bash
cd peer-review
npm install
npm start
# open http://localhost:3000
```

Optional environment variables:

| Variable        | Default                      | Purpose                                                                                                  |
|-----------------|------------------------------|----------------------------------------------------------------------------------------------------------|
| `PORT`          | `3000`                       | HTTP port                                                                                                |
| `DB_PATH`       | `./data/peer-review.json`    | JSON data file location                                                                                  |
| `ADMIN_TOKEN`   | _unset_                      | If set, admin endpoints require `?admin_token=...` or `X-Admin-Token` header. Recommended for real use.  |

## Anonymity model

The storage layout and write path are designed so it is **structurally impossible** to trace a rating back to its submitter:

- `ratings` entries contain only `{ rateeId, valueId, rating }` — no submitter field.
- `comments` entries contain only `{ rateeId, comment }` — no submitter field.
- The survey token is used **only** to validate one-time submission (`employees[].submitted`). The submitter's id is never written alongside any rating or comment.
- Comments are returned in a cryptographically shuffled order so response ordering can't hint at who wrote what.

## Usage

1. Start the app (see above).
2. On the admin page (`http://localhost:3000/`), paste your employee roster (one per line, `Name, email`) and your core values (one per line).
3. Click **Generate links**. The page shows each employee's Survey + Results link.
4. Send each person their Survey link. After the cycle ends, send each person their Results link.

Employees with an already-submitted survey cannot submit again — the token is burned on first successful submission.

## Data file

Everything is stored in `data/peer-review.json` inside the app folder. Back it up if you want to retain results. To start a fresh review cycle, open the admin page, paste the new roster, check **Reset existing data**, and click Generate.

## API

| Method | Path                       | Purpose                                                                 |
|--------|----------------------------|-------------------------------------------------------------------------|
| POST   | `/api/admin/setup`         | Create/reset roster + values; returns per-employee survey/results URLs. |
| GET    | `/api/admin/links`         | List all employees with links and submission status.                    |
| GET    | `/api/survey/:token`       | Returns survey config for this respondent (excludes them).              |
| POST   | `/api/survey/:token`       | Submit ratings + comments. One-time per token.                          |
| GET    | `/api/results/:token`      | Return aggregated ratings + shuffled anonymous comments.                |

## Production notes

- Set `ADMIN_TOKEN` to protect the setup page.
- Put the app behind HTTPS (e.g., Nginx, Caddy, or a PaaS) so tokens aren't exposed in transit.
- For real use with employees who aren't on your machine, the app needs to be hosted somewhere on the internet — locally, `http://localhost:3000` only works on your computer.
