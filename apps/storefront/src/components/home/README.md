# `components/home` — what is live and what is not

Six of the ten components in this folder render on the home page. Four do not,
and have never been imported by anything: `git grep` across `apps/**` and
`packages/**` finds no reference to them outside their own files, and
`git log -S` shows `page.tsx` has never imported one in any commit.

They were part of the original scaffold (`4673949`), written before the
catalogue moved onto the API, and were left behind when the home page was
rebuilt around it. Reading them as live code is the mistake this file exists to
prevent — they were deleted once for exactly that reason.

## Wired — rendered by `app/page.tsx`

| Component | Data |
|---|---|
| `HeroBanner` | category tree, from `getCategoryTree()` |
| `TrustBar` | static |
| `FeaturedProducts` | `GET /products?featured=true&sort=newest`, in Suspense |
| `NewArrivals` | `GET /products?sort=newest`, in Suspense |
| `BrandsStrip` | `GET /brands`, in Suspense |
| `CategoryGrid` | the same flattened category tree |

## Unwired scaffold — imported by nothing

Kept, not deleted. They encode design work, and deleting design assets to tidy
a folder is a bad exchange — but **none of them is a component you can drop into
a page and ship**. Each carries hard-coded placeholder content that would have
to be replaced by real data first.

| Component | What it is | What it would need |
|---|---|---|
| `RecommendedProducts` | Product rail with five hard-coded laptops, dollar prices, and a `products` prop that is accepted and then explicitly ignored (`const _products = products`) | The nearest to real. The API can already feed it — `GET /products` with a filter, the same call `FeaturedProducts` and `NewArrivals` make. It needs its dummy array replaced by the prop it already takes, and a recommendation rule decided (there is no personalisation domain). |
| `PromoBanner` | Two marketing banners, hard-coded: "Get discount on PS5 games", "-45%" | A promotions domain. Nothing in the system models a campaign, a date range or a discount, so the copy and the percentage would have to come from somewhere that does not exist. `DISCOUNT-MODEL.md` is where that starts. |
| `CategoryCircles` | Circular category picker over a hard-coded list — Chairs, Face, Jumpers, Laundry — from a general marketplace, not this shop | A decision about whether it duplicates `CategoryGrid`, which already renders the real API categories. If it is kept, it wants the real tree and this shop's categories. |
| `BlogSection` | Three placeholder posts with lorem-ish titles and emoji thumbnails | A content source. `ROUTES.blog` exists and `/blog` is a route, but there is no post model, no CMS and no author. |

## The rule

**Do not import one of these into a page without replacing its placeholder data
first.** Every one of them renders plausible-looking content that is fictional —
dollar prices in an EGP shop, products this store does not sell, a 45% discount
nobody authorised. Shipped as-is they would not look broken, which is what makes
them worth a warning rather than a deletion.

Wiring one is a feature, with its own data source and its own tests. It is not
cleanup.
