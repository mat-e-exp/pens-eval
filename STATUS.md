# Status

Current state only. History is in `git log`; ideas and research in `ROADMAP.md`.

## Now

- Browser dashboard for one uploaded HL SIPP account-summary CSV, served by `server.py` on port 3020. Behaviour: `README.md`.
- Stores nothing: no browser storage, no server writes (commit 4acb85d). Data rules and git hooks: `CLAUDE.md` → Data Handling.
- Rebalance plan has one Minimum rule covering small positions and small trades; each small position asks the user what to do, and speculative positions are left alone (9d6ed41, f08979c).
- devflow installed; the portfolio-data check runs from the commit-msg hook.
- `main` level with `origin/main` (checked 2026-11-09).

## Next

- **Decide (Mat):** how sectors are classified without `data/holdings-map.json`. This blocks removing the local real-data path (`data/live/` picker, `scan-files.py`, holdings-map loader in `script.js`). See `ROADMAP.md` → Known debt.
- Remove the name-based guessing lists in `script.js` (`symbolMap` and the sector/country guessers). They break the no-hardcoded-classification rule.
- Browser-level check of layout and charts. All changes so far were verified headlessly in node only.
- Roadmap candidates: 1. Fee drag (needs the HL platform % fee as a sourced, dated figure). 2. Stress view.

## Where we stopped

- Last work 2026-09-24: Minimum rule consolidation. Nothing in progress.
