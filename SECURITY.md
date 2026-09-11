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

### Running it yourself

CI is the backstop, not the first line — by the time it fails, the blob is
already on the remote. Both of these run locally with no dependencies:

```
pnpm secrets:scan                    # the whole history, exactly what CI runs
pnpm secrets:scan-file <path>        # one working-tree file, before you add it
```

The second one is the cheap half of the same job, and the only moment a secret
is still free to remove. Use it on anything arriving from outside the repository
— a vendored bundle, a pasted config, a downloaded fixture — before `git add`.

## The one history rewrite, and the credential that is not here

**Status: no credential exists in this repository's history. Nothing to do.**

`apps/admin/src/test.md` — a scratch file of shell lines — carried an
`ANTHROPIC_API_KEY` alongside `ANTHROPIC_BASE_URL=https://agentrouter.org`. It
was added in the initial commit, removed from the working tree four months
later, and therefore still sat in every branch's history where deleting the file
had done nothing about it.

**Before this repository's first push, the history was rewritten once** with
`git filter-repo --path apps/admin/src/test.md --invert-paths`, on a clone, and
the result verified by SHA rather than by filename: blob
`826d18a43510ceeeb6865809869b3021423ad3e2` is unreachable from every ref and is
absent from the object database entirely. The full scanner was then re-run over
the rewritten history — canary proof first — across 1,616 blobs, clean.

That rewrite was cheap precisely because it happened **before** the first push,
into a repository nobody had cloned. It is a one-time event and is not a
precedent: the same operation on a published history is a force-push that breaks
every existing clone, which is why the rule elsewhere in this file is to rotate
first and rewrite only by a deliberate decision.

### The key was rotated anyway, and had to be

The rewrite removed the value from *this* history. It did not un-expose it.

The key lived for four months in the predecessor repository
(`kerolles2003/Nest_Electro`), which was pushed to GitHub long before anyone
noticed. Anything that has reached a remote must be treated as compromised
regardless of what is done to the history afterwards, so **the credential was
rotated by the owner and is dead.** Removing it from the new history is
hygiene — it stops a future reader finding a live-looking secret and having to
work out whether it matters. It is not the remedy, and it was never the remedy.

### The cost, and where it went

Rewriting changed every commit SHA, and `WORK-LOG.md`, `HANDOFF.md`, `PLAN.md`
and the `docs/phase-2` reports cite dozens of them. Those documents were
**deliberately not edited** — a record rewritten to agree with a rewritten past
stops being a record. [`docs/commit-map.txt`](docs/commit-map.txt) maps all 141
old SHAs to their new ones so every citation stays resolvable. No commit was
dropped.

### What it cost, and why the scanner exists

The key sat in the predecessor repository for **four months** and was already on
its remote. A manual audit roughly forty commits earlier had called that
repository clean.

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
