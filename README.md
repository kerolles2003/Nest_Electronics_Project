# Nest Electronics

An electronics and embedded-systems store for Egypt — cash on delivery, prices in EGP. It is a
pnpm/Turborepo monorepo with three applications over one shared API: **`apps/api`**, a NestJS +
MongoDB service that owns every business rule and is the only thing that talks to the database;
**`apps/storefront`**, the Next.js customer site; and **`apps/admin`**, the Next.js back-office
console. A mobile client is a fourth consumer of the same API, on equal terms with the other
two — it gets no private endpoints and no special cases.

## Start here — mobile developer

Read these in order. The first two get you a running API you can call; the last two tell you
what to call and what is safe to depend on.

1. **[`docs/api/index.html`](docs/api/index.html)** — the whole HTTP contract, browsable.
   Download the repository and open the file in a browser; it needs no server and no running
   API, because the spec is embedded in the page. (GitHub renders it as source, not as a page.)
2. **[`docs/api/SANDBOX.md`](docs/api/SANDBOX.md)** — get the API running locally and get a
   seeded account to log in with.
3. **[`docs/api/MOBILE-HANDOFF.md`](docs/api/MOBILE-HANDOFF.md)** — screen by screen: which
   endpoints to call, in what order, with the flows written out end to end.
4. **[`docs/api/INTEGRATION.md`](docs/api/INTEGRATION.md)** — what is stable enough to build on
   now, what is still moving, and what you must never integrate against.

Read 4 before you design anything. "The endpoint exists" and "the endpoint is safe to depend
on" are different claims, and that document is where they are separated.

## Running it locally

**[`docs/api/SANDBOX.md`](docs/api/SANDBOX.md)** is the recipe, start to finish — prerequisites,
configuration, seeding, and the sandbox account. It is not repeated here, so it cannot go stale
here.

One thing worth knowing before you start, because it is the most common way this fails: MongoDB
must run **as a replica set, not a standalone**. The API writes orders in transactions, and a
standalone `mongod` rejects them with `Transaction numbers are only allowed on a replica set
member or mongos` — an error that arrives at checkout, far from its cause. `SANDBOX.md` §1 gives
the one-line Docker command that does it correctly.

## The frozen contract

[`docs/api/openapi.v1.json`](docs/api/openapi.v1.json) is the v1 contract, and it is **frozen and
additive-only**: nothing that a shipped client could already depend on may be removed, retyped,
or newly required. You can write a mobile client against that file and it will keep working.

This is enforced, not promised. CI regenerates the document from the live code on every run and
fails the build on *any* difference — a breaking change is refused outright, and even a purely
additive one fails until the regenerated artifact is committed in the same pull request, because
an artifact that lags behind the API is not a contract but a stale file people trust.
`docs/api/index.html` is generated from that same artifact and gated the same way, so the
browsable page cannot quietly drift from the JSON.

What the gate cannot catch — a narrowed enum, a tightened validator, a change in what a value
*means* — is listed in `INTEGRATION.md` under "What the gate does NOT catch". A green gate is the
absence of one specific class of mistake, not a compatibility guarantee.

## Everything else

`PLAN.md`, `HANDOFF.md` and `WORK-LOG.md` are the **build record of this engagement, not
documentation** — decisions, findings and history, written for whoever continues the work. If
you are looking for setup steps or the API contract, they are above; those three will not answer
you any faster.

Architecture and domain models live in [`docs/architecture/`](docs/architecture/).
