# Loading a catalogue from a spreadsheet

**Audience:** whoever is loading the products. No programming needed.
**The tool:** `apps/api/src/database/import/`

You have a spreadsheet of products. This turns it into the shop's catalogue.

It is safe to run more than once. Running the same file twice does nothing the
second time, so if a run goes wrong you fix the spreadsheet and run it again.

---

## The short version

```bash
# 1. See what WOULD happen. Nothing is written.
pnpm --filter api catalogue:import -- --file products.csv --profile my-profile.json --dry-run

# 2. If the report looks right, run it for real.
pnpm --filter api catalogue:import -- --file products.csv --profile my-profile.json
```

Always do step 1 first with a new file. It takes the same time and it cannot go
wrong.

**A note on paths.** `pnpm --filter api` runs the command from inside
`apps/api`, so a *relative* path is relative to that folder — which is why the
built-in profiles are given below as `src/database/import/profiles/...`. If your
spreadsheet is somewhere else, give its full path and there is nothing to think
about:

```bash
pnpm --filter api catalogue:import --   --file /home/mina/Downloads/acme-january.csv   --profile src/database/import/profiles/nest-standard.json   --dry-run
```

---

## What the spreadsheet needs

One row per product, one header row at the top. These five columns must have a
value in **every** row:

| What | Example | Notes |
|---|---|---|
| **A code** | `ESP32-DEVKIT-V1` | The product's own code. It must be unique and it must not change — it is how the tool recognises the same product next time. |
| **A name** | `ESP32 DevKit V1` | What the customer sees. |
| **A category** | `development-boards` | Must **already exist** in the shop. See below. |
| **A price** | `325.00` | See "How prices are read". |
| **A stock count** | `149` | A whole number. `0` is fine and means out of stock. |

Everything else is optional: short description, long description, brand, sale
price, cost price, low-stock level, "featured", weight.

**Your column headings can be anything.** They do not have to match the list
above — the profile (next section) is what connects your headings to these
meanings.

### Categories and brands must exist first

The tool will **not create a category or a brand.** If a row names one the shop
does not have, that row is reported as *skipped* and everything else still
imports.

That is deliberate. Which categories exist is a decision about how the shop is
organised, and a typo in a spreadsheet should not be able to add one to the
site's navigation. Create the category, run the file again, and the rows that
already imported will come back as *unchanged*.

---

## The profile: connecting your columns to the shop's fields

A **profile** is a small text file that says which of your columns means what.
It is why a spreadsheet from any supplier can be imported without anyone
changing the program.

Two are supplied, in `apps/api/src/database/import/profiles/`:

- **`nest-standard.json`** — use this if you are building the spreadsheet
  yourself. Name your columns `sku`, `name`, `category`, `price`, `stock` and so
  on, and it will work as-is.
- **`supplier-example.json`** — a worked example of a completely different
  spreadsheet: semicolons instead of commas, German headings, prices written
  `1.299,00`, and "Ja"/"Nein" instead of yes/no. It exists to show that a new
  supplier costs a new profile and nothing else.

### Writing one for a supplier

Copy `nest-standard.json` and change the `column` values to whatever the
supplier's headings actually say. Nothing else changes.

```jsonc
{
  "name": "acme-electronics",
  "description": "Acme's monthly price list.",

  // Only if the file uses semicolons instead of commas. Open it in a text
  // editor to check — European exports very often do.
  "delimiter": ";",

  "fields": {
    "sku":          { "column": "Item Code",   "type": "string",     "required": true },
    "name":         { "column": "Description", "type": "string",     "required": true },
    "categorySlug": { "column": "Group",       "type": "string",     "required": true },
    "basePrice":    { "column": "List Price",  "type": "minorUnits", "required": true },
    "onHand":       { "column": "In Stock",    "type": "integer",    "required": true },

    "brandSlug":    { "column": "Manufacturer", "type": "string" },
    "salePrice":    { "column": "Offer Price",  "type": "minorUnits" },

    // `default` is used when the cell is empty.
    "lowStockThreshold": { "column": "Reorder At", "type": "integer", "default": 5 },

    // If the supplier writes yes/no in their own words, list them.
    "isFeatured": {
      "column": "Highlight",
      "type": "boolean",
      "default": false,
      "trueValues": ["Ja", "J"],
      "falseValues": ["Nein"]
    }
  }
}
```

**The five types:**

| `type` | For | Accepts |
|---|---|---|
| `string` | text | anything; surrounding spaces are trimmed |
| `integer` | counts | `149`, `1,500` — a whole number. `12.7` is **rejected**, not rounded |
| `minorUnits` | money | see below |
| `boolean` | yes/no | `yes` `no` `true` `false` `1` `0` `y` `n` `-`, plus anything in `trueValues` / `falseValues` |
| `stringList` | several values in one cell | separated by **semicolons**: `a; b; c` |

**`required: true`** means a row with that cell empty is reported and not
imported. Half a product is worse than no product — it appears in the shop and
is wrong.

### A column the profile does not mention is left alone

If your file has no weight column, importing it will not erase the weights
products already have. The profile says what your file is *about*; anything it
does not mention, the import does not touch.

The same goes for **images**: an import never changes them, so photographs added
in the admin survive every price update.

---

## How prices are read

Write the price the way it appears on the invoice. All of these work:

| You write | It means |
|---|---|
| `325.00` | 325.00 EGP |
| `325` | 325.00 EGP — **not** 3.25 |
| `89.5` | 89.50 EGP |
| `1,299.00` | 1,299.00 EGP |
| `1.299,00` | 1,299.00 EGP (European style) |
| `EGP 45.00` | 45.00 EGP — currency symbols are ignored |

**A number with no decimal point is whole pounds.** `1299` is one thousand two
hundred and ninety-nine pounds.

Anything that is not a number — `call for quote`, `n/a`, `—` — is **reported,
not guessed at**. That row does not import and the rest of the file still does.

**A sale price must be lower than the normal price**, and above zero. A row
where it is not is reported.

---

## Reading the report

Every run prints something like this:

```
========================================================================
CATALOGUE IMPORT — COMPLETE
========================================================================
file     /home/mina/acme-january.csv
profile  acme-electronics
took     3.2s

  created       412
  updated        38
  unchanged    1204   (already correct — nothing written)
  skipped         6
  errored         2
  --------------------
  rows read     1662

8 row(s) need attention. Row numbers match the spreadsheet,
counting the header as row 1.

  row   118  SKIPPED  ACM-4471
             category "sensors-modules" does not exist. Create it first, or
             correct the spreadsheet — the import will not invent a category.
  row   904  ERRORED  ACM-8812
             basePrice: "call for quote" in column "List Price" is not a price

Nothing above was imported. Fix those rows in the spreadsheet and run the
import again — rows that already imported correctly will report as
"unchanged" and will not be written a second time.
```

| Line | Meaning | What to do |
|---|---|---|
| **created** | New products, now in the shop | Nothing |
| **updated** | Products that already existed and have changed | Nothing |
| **unchanged** | Already correct — **nothing was written** | Nothing |
| **skipped** | The row is fine, but names a category or brand the shop does not have | Create it, then run the file again |
| **errored** | The row itself is wrong — usually a price or a missing required cell | Fix the spreadsheet, then run the file again |

**Row numbers match your spreadsheet**, counting the header as row 1. Open the
file, go to that row, fix it.

A run with any skipped or errored rows exits with a failure code, so it is safe
to use inside a script.

---

## Things it will never do

- **It never deletes anything.** A product missing from the file is left exactly
  as it is. That matters: if a supplier's export fails and sends 40 rows instead
  of 4,000, the shop is not emptied.
- **It never invents a category or a brand.** It reports instead.
- **It never changes images.** Photographs added in the admin survive.
- **It never guesses at a value it cannot read.** It reports the row.

---

## Importing images

**Not supported yet, and it fails loudly rather than half-working.**

`--images` exists and refuses, because the shop has no image-hosting account
configured (D-4). Without one, uploaded pictures live only inside the running
program and disappear when it finishes — so every imported product would point
at a photograph that no longer exists. That is worse than having no photograph,
so the tool will not do it.

Import the products now; add their images through the admin once the account is
configured (Phase 7).

---

## When something goes wrong

| Message | Meaning |
|---|---|
| `the mapping profile is not usable: …` | The profile has a mistake. The message names the exact key. Nothing was read. |
| `does not map: name, categorySlug, …` | The profile is missing one of the five required fields. |
| `… is mapped to both X and Y` | Two fields point at the same column — usually a copy-paste slip. |
| `is not a yes/no value` | A yes/no column contains a word the tool does not know. Add it to `trueValues` or `falseValues`. |
| `already appears on row N of this file` | The same product code is on two rows. The tool imports neither, rather than letting one silently overwrite the other. |
| everything reads as one huge column | The file uses a different separator. Add `"delimiter": ";"` to the profile. |

If a run stops on the very first thing, nothing was written. If it runs and
reports errored rows, everything else **was** imported — fix those rows and run
it again.
