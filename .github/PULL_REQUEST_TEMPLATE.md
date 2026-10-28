## What this changes

<!-- One or two sentences: the outcome, not the file list. -->

## Why

<!-- The problem it solves or the decision behind it. -->

## How it was checked

<!-- The commands you actually ran. The repo's gate is:

     npm run lint        ESLint
     npm run format:check
     npm test            11 tests (accounts, sessions, theme)
     npm run check       the 35-step build loop (build, roster, skills,
                         routines, server, headless-browser smoke)

     The pre-commit hook runs format + lint for you. CI runs all four. -->

-

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run format:check` passes
- [ ] `npm test` passes
- [ ] `npm run check` passes
- [ ] No secrets, tokens, `.env` values or `data/` contents in this diff
- [ ] README / CHANGELOG updated if behaviour changed
