#!/usr/bin/env python3
"""Block commits that would put real-portfolio data into git (CLAUDE.md -> Data Handling).

Runs from the commit-msg hook: once on the staged changes, once on the message
(--message). commit-msg, not pre-commit, because devflow rewrites pre-commit.
Checks:
  1. No staged file under data/ except the allowlist below.
  2. No HL account-summary header lines outside data/test/: "Client Name:" or
     "Client Number:" with any value, or a figure line ("Total cash:", ...).
     The neutral example 12,345.67 is allowed.
Matched values are never printed, so the check itself does not echo real data.
  3. No figure or holding line from any real export found locally in data/live/.

Install once per clone:  sh hooks/install.sh  (writes .git/hooks/commit-msg, then runs devflow install)
"""
import glob
import re
import subprocess
import sys

DATA_ALLOWED = (
    'data/test/eu-uk-test-portfolio.csv',
    'data/benchmarks.json',
    'data/peer-benchmarks.json',
    'data/platform-charges.json',
    'data/api-keys.example.json',
)
HEADER = re.compile(
    r'(Client Name|Client Number|Spreadsheet created at|Stock value|Total cash|'
    r'Amount available to invest|Total value)\s*:?\s*,\s*"?\s*£?\s*([0-9][0-9,\.]*)',
    re.I)
NEUTRAL = {'12,345.67', '12345.67'}
IDENTITY = re.compile(r'(Client Name|Client Number)\s*:\s*,\s*"?\s*\S', re.I)


def git(*args):
    return subprocess.run(['git', *args], capture_output=True, check=True).stdout.decode('utf-8', 'replace')


def real_export_markers():
    """Figures (with a decimal point, 4+ digits) and holding names from local real exports."""
    figures, names = set(), set()
    for path in glob.glob('data/live/*.csv'):
        with open(path, encoding='latin-1') as f:
            for line in f:
                cells = re.findall(r'"([^"]*)"', line)
                for c in cells[1:] if len(cells) >= 7 else cells:
                    if '.' in c and len(re.sub(r'\D', '', c)) >= 4:
                        figures.update({c, c.replace(',', '')})
                if len(cells) >= 7 and not cells[0].lower().startswith('total'):
                    names.add(cells[0])
    return figures, names


def scan(text, where, figures, names):
    problems = []
    for m in IDENTITY.finditer(text):
        problems.append(f'{where}: HL "{m.group(1)}" line')
    for m in HEADER.finditer(text):
        if m.group(2) not in NEUTRAL and m.group(1).lower() not in ('client name', 'client number'):
            problems.append(f'{where}: HL "{m.group(1)}" line with a figure')
    for fig in figures:
        if re.search(r'(?<![\d,\.])' + re.escape(fig) + r'(?!\d)', text):
            problems.append(f'{where}: figure from a real export in data/live/')
            break
    for name in names:
        if name in text:
            problems.append(f'{where}: holding line from a real export in data/live/')
            break
    return problems


def main():
    figures, names = real_export_markers()
    problems = []
    if len(sys.argv) > 1 and sys.argv[1] == '--message':
        with open(sys.argv[2], encoding='utf-8') as f:
            msg = ''.join(l for l in f if not l.startswith('#'))
        problems += scan(msg, 'commit message', figures, names)
    else:
        staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR').split()
        for path in staged:
            if path.startswith('data/') and path not in DATA_ALLOWED:
                problems.append(f'{path}: files under data/ are not committed (allowlist in hooks/check_portfolio_data.py)')
        for path in staged:
            if path.startswith('data/test/'):
                continue
            added = '\n'.join(l[1:] for l in git('diff', '--cached', '-U0', '--', path).splitlines()
                              if l.startswith('+') and not l.startswith('+++'))
            problems += scan(added, path, figures, names)
    if problems:
        print('Commit blocked: possible real-portfolio data (CLAUDE.md -> Data Handling).', file=sys.stderr)
        for p in problems:
            print('  ' + p, file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
