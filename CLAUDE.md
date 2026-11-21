# Working rules for this repo

## Model use (owner's rule — keeps token use down)
| Work | Model |
|---|---|
| Planning, architecture, design, verification, important decisions | Opus |
| Building features, writing content, fixing bugs, routine edits | Sonnet |
| Mechanical jobs: renames, file moves, JSON formatting, simple checks | Haiku |

- At the start of every step, tell the owner which model the step needs. If the session is on a different model, nudge him to switch with `/model` before continuing.
- When running on Opus, hand large building or content jobs to a Sonnet subagent (or a Haiku one for mechanical work), then review the result on Opus.

## Workflow
- Build one feature at a time from `FEATURES.md`. Deploy it, share the live link for review, and start the next only after the owner approves. Tick it off in `FEATURES.md`.
- Test at phone (390px) and tablet (820px) widths before every deploy.
- Pushing to `main` deploys the site via GitHub Pages.

## Content rules
- Maharashtra HSC Std XII Science, English medium, Balbharati 2020 textbooks only. No NCERT, CBSE or other boards.
- Every item gives its textbook page (printed page, plus PDF page = printed + 10 for both Physics books).
- Write summaries in our own words. Never commit textbook PDFs, past papers or student data.
- Plain HTML/CSS/JS, no build step, no external dependencies unless approved.
