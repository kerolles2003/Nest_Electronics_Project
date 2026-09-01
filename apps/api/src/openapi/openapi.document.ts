import { DocumentBuilder } from "@nestjs/swagger";

/**
 * THE OpenAPI document definition — one source, two consumers.
 *
 * `main.ts` serves it at `/api/v1/docs`, and `export-openapi.ts` writes it to
 * `docs/api/openapi.v1.json` for the frozen artifact the CI drift gate checks.
 *
 * ## Why this was extracted rather than duplicated
 *
 * The frozen artifact only means something if it is the SAME document the
 * running API serves. A second `DocumentBuilder` chain maintained beside this
 * one would drift silently, and the gate would then be checking a copy against
 * a copy — the exact failure mode a contract freeze exists to prevent.
 *
 * Everything below is unchanged from `main.ts`; only its location moved.
 */
export function buildOpenApiDocumentConfig(port: number) {
  return new DocumentBuilder()
    .setTitle("Nest Electronics API")
    .setDescription(
      [
        "REST API for the Nest Electronics storefront, admin and mobile clients.",
        "",
        "### Conventions",
        "",
        "- **Base path** `/api/v1`. Within `v1` the contract is additive-only: new optional",
        "  fields and new endpoints may appear, but nothing is removed, renamed or retyped.",
        '- **Envelope** — success is `{ "data": … }`, plus `"meta"` on collections and',
        '  `"facets"` on product search. Every error is `{ "error": { code, message, … } }`,',
        "  so a client branches on which key is present.",
        "- **`error.code` is a stable enum — switch on it.** `error.message` is human-facing",
        "  and may change between releases; never parse it.",
        "- **Money** is always `{ amount, currency, formatted }` where `amount` is an integer",
        "  in minor units (piastres). `formatted` is for display only. Clients never do money",
        "  arithmetic — every total comes from the server.",
        "- **`POST /orders` requires an `Idempotency-Key` header** and is safe to retry with",
        "  the same key: `201` when the retry created the order, `200` when an earlier attempt",
        "  already had. The body is identical, so treat any 2xx as success.",
        "- **IDs** are 24-character MongoDB ObjectId hex strings, opaque to clients.",
        "- **Dates** are ISO 8601 UTC with `Z`.",
        "- **Nulls** — optional fields are `null`, never omitted, so Dart models stay stable.",
        "- **Enums** are `SCREAMING_SNAKE_CASE` strings.",
        "- **Localised text** is resolved server-side from `Accept-Language` (`en` or `ar`,",
        "  defaulting to `en`). Clients receive plain strings, never `{ en, ar }`.",
        "- **`X-Request-Id`** is echoed on every response and appears in `error.requestId`.",
        "  Quote it in a bug report and the server-side cause can be found directly.",
        "- **Unknown query parameters are rejected with `400 UNKNOWN_FIELD`.** This is a",
        "  security control, so send only documented parameters.",
        "",
        "",
        "### Authentication",
        "",
        "- Endpoints marked with a padlock require `Authorization: Bearer <accessToken>`.",
        "- Obtain the pair from `POST /auth/login`; the access token lives 15 minutes.",
        "- On `401 TOKEN_EXPIRED`, call `POST /auth/refresh` ONCE with the refresh token,",
        "  store the new pair, and retry the original request. A second 401 means sign out.",
        "- `401 REFRESH_TOKEN_REUSED` is terminal — the rotation chain has been revoked as a",
        "  suspected theft. Clear stored tokens and send the user to sign in.",
        "- The whole catalogue is public and needs no token.",
      ].join("\n"),
    )
    .setVersion("1")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Paste the `accessToken` from POST /auth/login. Sent as " +
          "`Authorization: Bearer <accessToken>`. It expires in 15 minutes; " +
          "use POST /auth/refresh to obtain a new pair.",
      },
      "bearer",
    )
    .addTag(
      "auth",
      "Registration, sign-in, session rotation and the current user",
    )
    .addTag(
      "catalog · products",
      "Product discovery, detail, suggestions and related items",
    )
    .addTag("catalog · categories", "Category list, tree and detail")
    .addTag("catalog · brands", "Brand list and detail")
    .addTag("cart", "The signed-in customer cart, re-priced on every read")
    .addTag(
      "addresses",
      "The signed-in customer address book. At most one address is the default, guaranteed " +
        "by a single atomic update. An address is the SOURCE of an order delivery address, " +
        "never a live reference from one.",
    )
    .addTag(
      "checkout",
      "The authoritative price breakdown for the current cart. No side effects, no reservation.",
    )
    .addTag(
      "orders",
      "The customer’s own orders: atomic placement (requires an Idempotency-Key; a replay " +
        "returns the original order), history, detail and self-service cancellation.",
    )
    .addTag(
      "admin · orders",
      "Staff order operations: the work queue and the six explicit lifecycle actions. " +
        "ADMIN or SUPER_ADMIN only.",
    )
    .addTag("health", "Liveness")
    .addServer(`http://localhost:${String(port)}`, "Local development")
    .build();
}
