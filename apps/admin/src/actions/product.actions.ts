'use server';

import { refresh, revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { requireAdminActor } from '@/lib/api/identity';
import type {
  AdminProduct,
  CreateProductBody,
  HardDeleteResult,
  UpdateProductBody,
} from '@/lib/api/types';

/**
 * Catalogue writes, through the API.
 *
 * ## What went, and why none of it is a loss
 *
 * These actions used to insert into Supabase `products`, upload to Supabase
 * Storage, and validate with `productSchema` from `@nest/types`. All three are
 * gone.
 *
 * **The Zod schema.** It described the LEGACY row — `stock_quantity`,
 * `base_price` as a float in pounds, `is_active` — none of which the API
 * accepts. Keeping a second validator in the shape of the old table would have
 * meant translating twice and being wrong in one of the translations. The API
 * validates and returns a per-field 400; `operatorMessage` renders it.
 *
 * **`logAdminAction`.** The API writes the audit record itself, inside the same
 * transaction as the write. A console-side audit call is a second write that
 * can fail on its own AFTER the catalogue changed, which produces exactly the
 * unaudited change the trail exists to make impossible. `lib/audit/log-action`
 * already refuses these writes — its `admin_id` has a foreign key to Supabase
 * `profiles` and the acting admin is an API account now.
 *
 * **The image upload loop.** Attaching an image is a reference-counted
 * operation with its own endpoints, and a product write that could carry image
 * descriptors would point a product at an asset nothing had retained — the
 * exact state that lets a live image be deleted.
 *
 * ## Money crosses this boundary as an integer
 *
 * The form collects EGP because that is what a person types. Everything below
 * `toPiastres` is minor units, because MONEY-MODEL.md has no floats in it and
 * the API rejects one rather than rounding it. The conversion happens HERE,
 * once, at the edge — not in the form, where a re-render could round twice, and
 * not in the API, which must never guess what unit it was handed.
 */

export interface ProductActionResult {
  ok: boolean;
  error?: string;
  /** Per-field messages the API returned, keyed by field name. */
  fieldErrors?: Record<string, string>;
  product?: AdminProduct;
}

/**
 * EGP as a person types it → piastres as the API stores it.
 *
 * `Math.round` rather than truncation: 12.345 typed into a price box is a
 * typo, not an instruction to drop a third of a piastre, and rounding to the
 * nearest minor unit is the behaviour that surprises nobody. A blank field is
 * `null`, which is how a sale is ended and a cost price cleared — distinct from
 * zero, which would be a claim that the thing is free.
 */
function toPiastres(egp: string | number | null | undefined): number | null {
  if (egp === null || egp === undefined || egp === '') return null;

  const value = typeof egp === 'number' ? egp : Number.parseFloat(egp);

  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** A trimmed string, or `null` — never the empty string, which the API reads as a value. */
function orNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}

/**
 * The form's shape. Deliberately NOT the API's.
 *
 * The form speaks in pounds and flat strings because that is what the inputs
 * produce; this module is where that becomes the API's shape. Doing it in the
 * component would put a money conversion inside a re-render.
 */
export interface ProductFormInput {
  sku: string;
  slug: string;
  nameEn: string;
  nameAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  descriptionEn: string;
  descriptionAr: string;
  categoryId: string;
  brandId: string;
  /** EGP, as typed. */
  basePrice: string;
  salePrice: string;
  costPrice: string;
  /** Grams. */
  weight: string;
  length: string;
  width: string;
  height: string;
  seoTitle: string;
  seoDescription: string;
  isFeatured: boolean;
  specs: { key: string; label: string; value: string; unit: string; filterable: boolean }[];
}

function toWriteBody(input: ProductFormInput): Omit<CreateProductBody, 'sku'> {
  const basePrice = toPiastres(input.basePrice) ?? 0;

  const length = Number.parseInt(input.length, 10);
  const width = Number.parseInt(input.width, 10);
  const height = Number.parseInt(input.height, 10);
  const hasDimensions =
    Number.isFinite(length) && Number.isFinite(width) && Number.isFinite(height);

  const weight = Number.parseInt(input.weight, 10);

  return {
    slug: input.slug.trim(),
    name: { en: input.nameEn.trim(), ar: orNull(input.nameAr) },
    shortDescription:
      orNull(input.shortDescriptionEn) === null
        ? null
        : { en: input.shortDescriptionEn.trim(), ar: orNull(input.shortDescriptionAr) },
    description:
      orNull(input.descriptionEn) === null
        ? null
        : { en: input.descriptionEn.trim(), ar: orNull(input.descriptionAr) },
    categoryId: input.categoryId,
    brandId: orNull(input.brandId),
    basePrice,
    salePrice: toPiastres(input.salePrice),
    costPrice: toPiastres(input.costPrice),
    /*
     * `sortOrder` is the array index, assigned here rather than accepted from a
     * field. Two rows a person numbered identically would otherwise produce an
     * order the database resolves arbitrarily, and the operator would see the
     * spec sheet reshuffle itself on save.
     */
    specs: input.specs
      .filter((spec) => spec.key.trim() !== '' && spec.value.trim() !== '')
      .map((spec, index) => ({
        key: spec.key.trim(),
        label: spec.label.trim() === '' ? spec.key.trim() : spec.label.trim(),
        value: spec.value.trim(),
        unit: orNull(spec.unit),
        filterable: spec.filterable,
        sortOrder: index,
      })),
    seo:
      orNull(input.seoTitle) === null && orNull(input.seoDescription) === null
        ? null
        : { title: orNull(input.seoTitle), description: orNull(input.seoDescription) },
    weight: Number.isFinite(weight) ? weight : null,
    dimensions: hasDimensions ? { length, width, height } : null,
    isFeatured: input.isFeatured,
  };
}

/**
 * Turns the API's `details[]` into per-field messages the form can mark inputs
 * with, so an operator is told WHICH box is wrong rather than reading a
 * sentence at the top of a long form and hunting for it.
 */
function fieldErrorsFrom(error: {
  readonly details?: readonly { readonly field?: string | null; readonly message: string }[];
}): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const detail of error.details ?? []) {
    const field = detail.field ?? '';

    if (field !== '' && errors[field] === undefined) errors[field] = detail.message;
  }

  return errors;
}

/**
 * ROUTE paths, not URLs.
 *
 * `revalidatePath` takes the route file structure, so `basePath` is not part of
 * it: `/products`, never `/admin/products`. The second form names a route that
 * does not exist and revalidates nothing — it was in this console in a couple
 * of places, doing nothing quietly.
 *
 * `refresh()` updates the client router so the screen in front of the operator
 * re-reads, rather than leaving each component to call `router.refresh()` and
 * one of them to forget.
 */
function revalidateCatalogue(productId?: string): void {
  revalidatePath('/products');
  revalidatePath('/inventory');
  revalidatePath('/');

  if (productId !== undefined) revalidatePath(`/products/${productId}/edit`);

  refresh();
}

/**
 * Creates a product — UNPUBLISHED, whatever the form says.
 *
 * `isActive` is not sent. The API defaults it to `false` here against the
 * schema default of `true`, because a product created through this endpoint has
 * no images and no stock yet, and publishing it at the instant it is named puts
 * a bare row in a customer's search results. Publish is a separate action, and
 * the form says so.
 */
export async function createProductAction(input: ProductFormInput): Promise<ProductActionResult> {
  await requireAdminActor();

  const res = await tryApi(() =>
    api.createProduct({ sku: input.sku.trim().toUpperCase(), ...toWriteBody(input) }),
  );

  if (!res.ok) {
    return { ok: false, error: operatorMessage(res.error), fieldErrors: fieldErrorsFrom(res.error) };
  }

  revalidateCatalogue(res.data.data.id);

  return { ok: true, product: res.data.data };
}

/**
 * Edits a product. `sku` is not sent, because it is immutable after creation:
 * it is the warehouse identifier, printed on labels and quoted to suppliers.
 */
export async function updateProductAction(
  id: string,
  input: ProductFormInput,
): Promise<ProductActionResult> {
  await requireAdminActor();

  const body: UpdateProductBody = toWriteBody(input);
  const res = await tryApi(() => api.updateProduct(id, body));

  if (!res.ok) {
    return { ok: false, error: operatorMessage(res.error), fieldErrors: fieldErrorsFrom(res.error) };
  }

  revalidateCatalogue(id);

  return { ok: true, product: res.data.data };
}

/** Makes a product publicly visible. Separately audited, which is why it is not a checkbox. */
export async function publishProductAction(id: string): Promise<ProductActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.publishProduct(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateCatalogue(id);

  return { ok: true, product: res.data.data };
}

export async function unpublishProductAction(id: string): Promise<ProductActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.unpublishProduct(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateCatalogue(id);

  return { ok: true, product: res.data.data };
}

/**
 * Soft delete: recoverable, hidden everywhere public, and it KEEPS its slug and
 * SKU. Reusing either would silently repoint existing links at a different
 * product, so a duplicate is refused while the deleted row still holds them.
 */
export async function softDeleteProductAction(id: string): Promise<ProductActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.softDeleteProduct(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateCatalogue(id);

  return { ok: true, product: res.data.data };
}

export async function restoreProductAction(id: string): Promise<ProductActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.restoreProduct(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateCatalogue(id);

  return { ok: true, product: res.data.data };
}

export interface HardDeleteActionResult {
  ok: boolean;
  error?: string;
  result?: HardDeleteResult;
}

/**
 * Permanent, and it destroys the images nothing else is showing.
 *
 * SUPER_ADMIN only and refused for a product any order refers to — orders keep
 * `productId` for traceability and reorder, and destroying the document turns
 * that into a dangling id. The refusal names the order count, and soft delete
 * is the answer for that case, which is what soft delete is for.
 */
export async function hardDeleteProductAction(id: string): Promise<HardDeleteActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.hardDeleteProduct(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateCatalogue();

  return { ok: true, result: res.data.data };
}
