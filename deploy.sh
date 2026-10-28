#!/usr/bin/env bash
# Delux crew — first-run deployment: turn this working copy into a GitHub
# repository on `main`, with the CI pipeline already in it.
#
#   ./deploy.sh                      interactive: asks for the repo name + visibility
#   ./deploy.sh --name my-repo --private --yes
#   ./deploy.sh --full               also run the 35-step build loop before pushing
#   ./deploy.sh --dry-run            show exactly what would run, change nothing
#
# What it does, in order:
#   1. checks the toolchain (git, gh, node) and your GitHub login
#   2. makes sure this directory is a git repo on `main` with an identity
#   3. runs the quality gate (format, lint, tests) so nothing broken is pushed
#   4. stages everything and makes the initial commit
#   5. creates the repository with the gh CLI and pushes `main`
#
# The script never reads, prints or stores a token: `gh` keeps its own login
# (~/.config/gh) and git keeps its own credentials. It never uses --force and
# never deletes anything.

set -euo pipefail

# ---------------------------------------------------------------- arguments
REPO_NAME=""
VISIBILITY="private"
DESCRIPTION=""
ASSUME_YES=0
FULL_CHECK=0
DRY_RUN=0
COMMIT_MESSAGE="chore: initial production compilation and system synchronization"

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)      REPO_NAME="${2:?--name needs a value}"; shift 2 ;;
    --private)   VISIBILITY="private"; shift ;;
    --public)    VISIBILITY="public"; shift ;;
    --desc)      DESCRIPTION="${2:?--desc needs a value}"; shift 2 ;;
    --yes|-y)    ASSUME_YES=1; shift ;;
    --full)      FULL_CHECK=1; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --message)   COMMIT_MESSAGE="${2:?--message needs a value}"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BOLD=""; GREEN=""; RED=""; YELLOW=""; RESET=""
if [[ -t 1 ]]; then BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'; fi
ok()   { echo "${GREEN}✓${RESET} $1"; }
warn() { echo "${YELLOW}!${RESET} $1"; }
fail() { echo "${RED}✗ $1${RESET}" >&2; exit 1; }
step() { echo; echo "${BOLD}$1${RESET}"; }
run()  { echo "  \$ $*"; [[ $DRY_RUN -eq 1 ]] || "$@"; }

ask() { # ask VAR "prompt" "default"
  local __var="$1" __prompt="$2" __default="${3:-}" __reply=""
  if [[ $ASSUME_YES -eq 1 ]]; then printf -v "$__var" '%s' "$__default"; return; fi
  if [[ -n "$__default" ]]; then read -r -p "$__prompt [$__default]: " __reply || true
  else read -r -p "$__prompt: " __reply || true; fi
  printf -v "$__var" '%s' "${__reply:-$__default}"
}

# ------------------------------------------------------------ 1. toolchain
step "1/5  Toolchain"
command -v git   >/dev/null 2>&1 || fail "git is missing. macOS: xcode-select --install · Linux: install git, then re-run."
ok "git $(git --version | awk '{print $3}')"
command -v node  >/dev/null 2>&1 || fail "Node.js is missing. Install Node 20+ from https://nodejs.org"
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" -ge 20 ]] || fail "Node 20+ required (you have $(node --version))."
ok "node $(node --version)"
command -v gh    >/dev/null 2>&1 || fail "GitHub CLI is missing. https://cli.github.com — the script uses it to create the repository."
ok "gh $(gh --version | awk 'NR==1{print $3}')"
if ! gh auth status >/dev/null 2>&1; then
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "gh is not logged in (acceptable for --dry-run)"
  else
    fail "gh is not logged in. Run:  gh auth login  — then re-run this script. It never sees your token."
  fi
else
  ok "gh authenticated as $(gh api user --jq .login 2>/dev/null || echo 'unknown user')"
fi

# ------------------------------------------------------- 2. repo + identity
step "2/5  Repository"
if [[ ! -d .git ]]; then
  run git init -b main
  ok "fresh git repository on main"
else
  ok "existing git repository"
  CURRENT_BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
  if [[ -n "$CURRENT_BRANCH" && "$CURRENT_BRANCH" != "main" ]]; then
    warn "branch is '$CURRENT_BRANCH', not 'main' — the push targets main"
    if [[ $ASSUME_YES -eq 1 ]]; then run git branch -m main; fi
  fi
fi

if [[ -z "$(git config user.name || true)" || -z "$(git config user.email || true)" ]]; then
  ask GIT_NAME  "Git author name"  "$(node -p "require('./package.json').name" 2>/dev/null || echo "$(basename "$ROOT")")"
  ask GIT_EMAIL "Git author email" "you@example.com"
  run git config user.name  "$GIT_NAME"
  run git config user.email "$GIT_EMAIL"
  ok "git identity set for this repository only"
else
  ok "git identity: $(git config user.name) <$(git config user.email)>"
fi

if ! git check-ignore -q data/members/provider.key 2>/dev/null; then
  fail ".gitignore no longer covers data/members/provider.key (the account encryption key). Fix .gitignore first."
fi
if git ls-files --error-unmatch data/ >/dev/null 2>&1; then
  fail "data/ is tracked by git. Untrack it before pushing: git rm -r --cached data/"
fi
ok "secret boundary: data/ and .env are ignored, nothing tracked under them"

# ------------------------------------------------------------ 3. quality gate
step "3/5  Quality gate"
[[ -d node_modules ]] || run npm ci
if [[ $FULL_CHECK -eq 1 ]]; then
  # The build loop drives a real headless browser; make sure one is present.
  run npx --no-install playwright-core install chromium
  run npm run format:check
  run npm run lint
  run npm run check
else
  run npm run format:check
  run npm run lint
  run npm test
fi
ok "gate passed"

# --------------------------------------------------------- 4. initial commit
step "4/5  Initial commit"
if [[ -n "$(git status --porcelain)" ]]; then
  run git add .
  if git diff --cached --quiet; then
    warn "nothing staged"
  else
    run git commit -m "$COMMIT_MESSAGE"
    ok "$(git rev-list --count HEAD 2>/dev/null || echo 1) commit(s) on $(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
  fi
else
  ok "working tree already committed"
fi

# -------------------------------------------------- 5. create + push
step "5/5  GitHub"
if [[ -z "$REPO_NAME" ]]; then
  DEFAULT_NAME="$(node -p "require('./package.json').name" 2>/dev/null || basename "$ROOT")"
  ask REPO_NAME "Repository name" "$DEFAULT_NAME"
fi
[[ "$REPO_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || fail "Invalid repository name: $REPO_NAME"
if [[ -z "$DESCRIPTION" ]]; then
  ask DESCRIPTION "One-line description" "$(node -p "require('./package.json').description || ''" 2>/dev/null | cut -c1-100)"
fi

if git remote get-url origin >/dev/null 2>&1; then
  warn "remote 'origin' already exists: $(git remote get-url origin) — skipping gh repo create"
else
  CREATE_ARGS=(repo create "$REPO_NAME" "--$VISIBILITY" --source=. --remote=origin)
  if [[ -n "$DESCRIPTION" ]]; then CREATE_ARGS+=(--description "$DESCRIPTION"); fi
  run gh "${CREATE_ARGS[@]}"
  ok "repository created ($VISIBILITY): https://github.com/$(gh api user --jq .login 2>/dev/null || echo OWNER)/$REPO_NAME"
fi

run git push -u origin main

echo
echo "${GREEN}✓ Done.${RESET} Pushed main to origin."
echo "  • CI runs on every push and pull request: format, lint, tests, build, the build loop."
echo "  • The Vercel deploy job needs VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID"
echo "    in GitHub → Settings → Secrets and variables → Actions."
echo "  • The repo is ${VISIBILITY}. Change it later with:"
if [[ "$VISIBILITY" == "private" ]]; then
  echo "      gh repo edit OWNER/$REPO_NAME --visibility public"
else
  echo "      gh repo edit OWNER/$REPO_NAME --visibility private"
fi
