#!/bin/sh
# Install git hooks for this clone.
# pre-commit belongs to devflow (devflow install/update rewrite it).
# commit-msg runs the portfolio data check on the staged changes and the
# message; devflow never touches commit-msg, so the check survives updates.
set -e
cd "$(git rev-parse --show-toplevel)"
git config --unset core.hooksPath 2>/dev/null || true
cat > .git/hooks/commit-msg <<'HOOK'
#!/bin/sh
# Portfolio data check (CLAUDE.md -> Data Handling)
python3 hooks/check_portfolio_data.py || exit 1
exec python3 hooks/check_portfolio_data.py --message "$1"
HOOK
chmod +x .git/hooks/commit-msg
devflow install
