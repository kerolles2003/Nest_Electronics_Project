# Security

## Reporting a vulnerability

Report privately to the repository owner. Do not open a public issue, and do not
include a working exploit or a live credential in the report.

## Secrets are scanned on every push

`scripts/scan-secrets.mjs` runs as a blocking CI check
(`.github/workflows/secret-scan.yml`) on every push to every branch and on every
pull request. It reads **every blob reachable from every ref** — contents, not
filenames — because deleting a secret does nothing: the blob stays in the
history, and the history is what gets cloned.

The scanner proves itself before it trusts itself. Each pattern is run against a
fake secret of its own class on every run, and the build fails if any pattern
does not fire. A scanner that has never found anything is indistinguishable from
one that cannot.

**If it fails: rotate first.** Pushing is irreversible — once a credential
reaches a remote, rotation is the only remedy, and deleting the file is not a
fix. Rotate the credential, then decide with the owner whether to rewrite
history or to record the finding here and allowlist the blob.

## A rotated credential in early history — do not panic, do not rewrite

**Status: inert. No action required.**

`apps/admin/src/test.md` — a scratch file of shell lines — contained an
`ANTHROPIC_API_KEY` alongside `ANTHROPIC_BASE_URL=https://agentrouter.org`.

| | |
|---|---|
| Added | `4673949` — the initial commit, 2026-05-01 |
| Removed from the tree | `4b29fa0`, 2026-09-01 |
| Found | 2026-09-09, by `scripts/scan-secrets.mjs` on its first real run |
| **Rotated** | **2026-09-09, by the owner. The value is dead.** |
| Blob | `826d18a43510ceeeb6865809869b3021423ad3e2` |

It is still reachable from the history of every branch, and it is **deliberately
left there**. Two reasons:

1. **The credential is already rotated**, so the value in the history authorises
   nothing. Rewriting history to remove a dead string buys nothing.
2. **The cost is real.** Purging it means rewriting 130-odd commits and
   force-pushing over a handover, which breaks every existing clone and every
   commit SHA referenced in `WORK-LOG.md`, `PLAN.md` and this file. That is a
   large, irreversible operation in exchange for tidiness.

If you are reading this because you found that key: it is expected, it is dead,
and it is recorded. **Do not start a history rewrite on your own account.** Its
blob SHA is allowlisted by SHA — not by path or by pattern — in
`scripts/scan-secrets.mjs`, so a single edited byte produces a new blob that is
not allowlisted and fails the build.

### What it cost, and why the scanner exists

The key sat in the repository for **four months** and was **already on the
remote** — pushed long before it was noticed. A manual audit roughly forty
commits earlier had called the repository clean.

Nobody was careless. A manual audit is a thing you have to remember to do, and
the one time it is skipped is the time it was needed. That is the whole argument
for the CI check: the window between "committed" and "noticed" is the entire
risk, and a job closes it to one run.

## Configuration

No real `.env` file has ever been committed, on any ref. Only `.env.example`
files are tracked, and every real `.env` is gitignored.

The examples ship values the schema **rejects**, which is not the same as values
that merely look fake. `apps/api/.env.example` carries
`JWT_SECRET=REPLACE_WITH_A_LOCALLY_GENERATED_KEY_OF_AT_LEAST_32_CHARS` — 57
characters, so it satisfies a naive `min(32)` rule and would have booted a real
API signing tokens with a key that is in the repository. `PLACEHOLDER_SECRET`
(`/^REPLACE_/i`) refuses it, and `apps/api/test/infrastructure/env-example.spec.ts`
asserts the example file's own value keeps matching that refusal.

**A placeholder nothing rejects is a default.** That is how a working signing key
shipped in an example file here once already.

`apps/admin/.env.example` and `apps/storefront/.env.example` use `YOUR_*`
placeholders, which nothing rejects because those apps have no equivalent env
schema. Neither carries a live value, but the guarantee there is convention
rather than a gate.
