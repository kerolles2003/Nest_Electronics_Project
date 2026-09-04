# Storefront QA findings

Five source comments in this app point at "the QA report" — `Footer.tsx`,
`HeroBanner.tsx`, `products/(listing)/page.tsx` and two places in
`products/[slug]/page.tsx` — as the place where a deferred decision was written
down.

**That report was never written.** The pass that made those references was
interrupted before it produced either the defect list or the ranked UX critique
it had been asked for; what survived was the code changes, the crawl scripts in
`e2e/qa/`, and `e2e/qa-layout.spec.ts`. This file is that list, reconstructed
from the evidence those artefacts left behind, so the five references resolve
and the owner has something to act on other than a diff.

## What the pass actually did, and where its data is

It crawled **24 screens at five viewport widths** — 360, 390, 768, 1024, 1440 —
capturing a screenshot of each and one machine-readable record per screen and
width. That is `apps/storefront/qa-shots/`: 123 PNGs, a `before/` set at 390,
and `report.json`, 120 records carrying `bodyScrollsSideways`, the list of
`overflowing` elements with their coordinates, `smallTargets` with measured
sizes, `h1s`, `mains`, `imagesBroken`, `imagesInvisible` and `imagesWithoutAlt`.

**`qa-shots/` is gitignored**, so that evidence exists on this machine and
nowhere else and will not survive a clean checkout. The aggregate below is taken
from it and belongs in the repository; the raw crawl is worth keeping somewhere
if anyone wants to re-derive it. Re-running it is `e2e/qa/screenshot.mjs` and
`e2e/qa/overflow.mjs` against a dev server.

Aggregated over the 120 records:

| Signal | Result |
|---|---|
| Body scrolls sideways | **7 screens**, at 360 and 390 only — `/products` and its four variants by 90px and 61px, the two product-detail shapes by 71–77px and 43–49px, home by 42px and 14px |
| `<main>` count | 1 on all 120. This half never failed |
| `<h1>` count | 0 on the four `/products` shapes; 1 everywhere else |
| Images with no `alt` | none |
| Broken images | 5, all on `/blog` — see **Open 9** |
| Invisible images | none *in this crawl*, and that is the trap: it ran with no Cloudinary cloud name, so no product image existed to be invisible. See **Fixed 12** |
| Tap targets under 44px | the wishlist icon at 32x32 on all 135 sightings, cart and account at 32x28, "Open menu" at 40x40, the logo at 129x40, the top-bar links at 18px tall |

Everything under **Fixed** is committed and, where a test could reach it,
covered. Everything under **Open** is a decision, a feature, or a change to code
this line of work does not own.

---

## Fixed

### 1. Six links in the site chrome were 404s, on every page

`/about`, `/brands`, `/faq`, `/returns`, `/shipping` and `/vendors` were in
`TOP_NAV_LINKS`, `MAIN_NAV_LINKS` and the footer. None has ever been a route.
There are twenty-three customer-facing pages and every one of them carried these
six dead links in its header and footer.

`/shipping` and `/returns` are the two a first-time cash-on-delivery customer
looks for before ordering. Removed rather than redirected — see **Open 1**.

### 2. The footer was drawn in its own background colour

The footer sits on `--color-topbar` (#1a1a2e) and styled its text from the
*light* palette. The brand name and all three column headings used
`text-foreground`, which **is** #1a1a2e: contrast 1:1, invisible. The links used
`text-foreground-muted` (#6b7280) at 3.4:1, below AA. `TopBar` sits on the same
colour and already used the right tokens.

### 3. Every link on the wishlist page was dead

The store kept product **ids** and linked to `/products/<id>`. Products resolve
by slug only, so every row 404'd. The rows had nothing else to show either,
rendering `Product #664f1a2b` with the full id beneath.

### 4. The product page printed the currency twice and rounded the price

`formatPrice` returned `EGP 280` and each call site appended its own `EGP`, so
the largest text on the page read **"EGP 280 EGP"**. It also used `Math.round`,
so 149.99 EGP — the commonest shape a price takes — displayed as **150 EGP**,
a pound above what the cart, the checkout quote and the order confirmation all
say, since those use the server's `Money.formatted`.

### 5. Two dead controls on the product page

A tab bar whose three tabs did nothing — plain `<button>`s in a server
component, with the description *and* the specifications rendering stacked below
regardless — and an image thumbnail strip with `cursor-pointer`, a hover-scale,
a hover-opacity lift and a selected ring, all on `<div>`s, wired to nothing. The
Reviews tab advertised a feature explicitly not in v1.

A control that looks interactive and is not is worse than no control: the
customer concludes the page is broken rather than that the feature is absent.

### 6. The closed mobile drawer was still in the tab order

It is always in the DOM and merely translated off-screen, so its eleven links
and buttons were keyboard-focusable on **every page** — a keyboard user tabbing
off the logo fell into an invisible menu — and nothing listened for Escape once
they were in there. Now `inert` while closed.

### 7. Tap targets below the 44px `DESIGN.md` 8 minimum

The header's wishlist, account and cart controls were 32x28 — the three
most-tapped things on the site. The hero's slide dots were 8x6 and 40x6, the
smallest controls on the site sitting on its largest element.

### 8. Checkout sent you away and gave you no way back

With an empty address book, checkout offered "Add a delivery address" and a link
into the account area that was the end of the flow: the order was nowhere on
screen and returning meant knowing to press Back twice.

### 9. The verification screen had no exit, and the resend offer never rendered

Verification tokens are single-use by design, so a reload or an email scanner's
prefetch lands on the failure screen — which said only that it could not verify.
Separately, the sign-in form's "resend the verification email" offer was guarded
by `error.includes('not verified')` against a message the API words
*"Verify your email address before signing in."*: it matched nothing, so the
control could never appear, and the types and the build were clean throughout.

### 10. The wishlist panel promised something the system cannot do

*"Sign in to sync your wishlist across devices and access it anywhere."* There
is no wishlist endpoint; server-side wishlists are Phase 8. Signing in cannot
make it true, and clearing the browser loses the list.

### 11. Two hard-coded copyright years that disagreed

The footer said 2025 and the auth panel said 2026. One of the two was always
going to be wrong.

### 12. No browser test had ever rendered a product image

`imageUrl()` returns `null` without a Cloudinary cloud name and the Playwright
environment set none, so every product in every spec drew its letter
placeholder. That is how `ProductCard` shipped drawing every image at
`opacity: 0` — loaded, decoded, laid out, invisible — through ninety-six
passing tests. Fixed in the harness, which is what makes finding 13 assertable
at all.

### 13. `/cart` was an untitled document for the whole of its first paint

`CartView` has an `<h1>` in each of its three real states and **none in its
loading state**, which is where the page spends its first second every single
time — `useCart()` fetches after hydration. A crawler that does not wait, a
heading list and "jump to first heading" all saw a page with no heading at all.
Found by running `qa-layout.spec.ts`, not by the original crawl, which had
captured `/cart` after it settled.

### 14. The five bottom-bar controls were 37px tall inside a 56px bar

`MobileBottomNav` is `h-14` and laid its links out with `items-center`, so each
link sized to its 37px of content and left 19px of the bar tappable by nothing.
The five most-used controls on a phone, each 7px under the minimum, in a bar that
was already big enough. `items-stretch` fixes it and changes no drawn pixel —
each link centres its own icon and label. The header logo was 130x40 for the
same kind of reason.

### 15. A test that asserted the wrong property and could never have passed

`qa-layout.spec.ts`'s `inert` test counted
`drawer.querySelectorAll('a[href], button, …')` and expected zero. **`inert`
does not remove elements from the DOM** — it removes them from the tab order and
the accessibility tree — so that count is ten whether the fix is present or not.
It failed against correct code, and had been recorded as an unfixed defect. It
now walks focus with Tab from the top of the document and asserts it never lands
inside the drawer, which is both what the finding was about and a property that
is false without `inert` and true with it.

### 16. Fixed earlier in the pass, and now covered by `qa-layout.spec.ts`

- Every product image on a catalogue page rendered at `opacity: 0`; twelve of
  twenty-one on the home page.
- `packages/ui` was not a Tailwind source, so ~135 utilities used only there
  produced no CSS: the sale badge's background, the gold star fill, the toast's
  z-index, `sr-only`. The classes the storefront *also* used were emitted, so
  the library was styled in patches — which looks like a design rather than a
  build failure.
- The catalogue had no `<h1>`.
- `--color-warning` was undefined, so every `pending` order badge — where every
  cash-on-delivery order starts — drew with no background, no border and
  inherited text.

---

## Open

Ranked by what it costs a customer, not by effort.

### 1. `/shipping` and `/returns` do not exist — **highest**

This is a **cash-on-delivery** shop. The two questions a first-time customer
asks before committing are what delivery costs and what happens if the thing is
wrong, and the site answers neither. The links were removed because pointing
them somewhere plausible is worse than nothing, but the content is the actual
fix, and it is content, not code. `/about` and `/faq` are the same argument one
notch down. Each link returns to `TOP_NAV_LINKS` or the footer the day its page
exists.

### 2. The product page has no gallery

Fixing finding 5 removed affordances that promised a gallery the page could not
open. A product with three photographs shows three thumbnails and no way to
enlarge one, which for a components shop — where the photograph is how you
confirm the pin header, the connector, the revision — is a real gap. Needs a
client component; no new API.

### 3. The product page still re-derives a price the server already formatted

`MONEY-MODEL.md` says the server produces `formatted` precisely so no client
re-derives a price. The view model divides `pricing.basePrice.amount` by 100 and
throws the formatted string away. The **number** is now right; the layering is
not. Using `formatted` means giving up the design where the amount is large and
the currency small beside it — a design decision. Held under three entries in
`apps/api/test/infrastructure/money-formatting.spec.ts`, whose prose still says
"REPORTED, NOT FIXED … uncommitted work this session was asked not to touch";
that sentence is now stale and should be reworded by whoever owns that file.

### 4. Verification is not idempotent

Presenting the token of an already-verified address fails rather than succeeding.
An email scanner that fetches links, or a customer who reloads, therefore sees a
failure for an account that is fine. The storefront now offers a way onward, but
the real fix is on the API and was deliberately not reached for from here.

### 5. Reviews are advertised nowhere and counted everywhere

`product.reviewCount` and `product.rating` render on the product page —
"38 verified reviews", a star average — and there is no review domain. The
numbers come from fields nothing writes. Either the domain gets built or those
two elements come off the page; today they assert something untrue about the
product.

### 6. The hero's slide dots are 44px tall and not 44px wide

Made thumb-height without moving them. Making them 44px **wide** spaces them
four times further apart, which changes the hero's design rather than fixing it.

### 7. `TOP_NAV_LINKS` holding one link is not a design

"Support" in the footer holds a single "Contact us", and the top bar holds a
single "Contact". Both are the honest current state after the dead links came
out, and both look like an oversight. They resolve themselves when **Open 1**
does.

### 8. The wishlist page shows slugs where names belong

`usb-logic-analyser-8-channel` is at least a working link to the right product,
which is a strict improvement on a dead link reading `Product #664f1a2b`. It is
still not a product name. The page holds slugs and nothing else, so showing a
name means fetching the products — cheap, and worth doing when the page is next
opened up.

### 9. `/blog` serves five broken images, and is still on Supabase

The crawl found five broken images on `/blog` at every width. The route reads
through `getServices()` — the Supabase path — and there is no post model, no CMS
and no author in the API. It is Phase 8 territory and was deliberately left
alone, but the broken images are worth knowing about before anyone links to it.

### 10. `RecommendedProducts` is the nearest unwired scaffold to real

`src/components/home/README.md` has the full table. It accepts a `products` prop,
explicitly ignores it, and renders five hard-coded laptops with dollar prices.
The API can feed it with the same call `FeaturedProducts` already makes; what is
missing is a recommendation rule, and there is no personalisation domain.
