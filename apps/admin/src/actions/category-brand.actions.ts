'use server';

import { refresh, revalidatePath } from 'next/cache';
import { tryApi } from '@/lib/api/client';
import * as api from '@/lib/api/endpoints';
import { operatorMessage } from '@/lib/api/errors';
import { requireAdminActor } from '@/lib/api/identity';
import type { AdminBrand, AdminCategory } from '@/lib/api/types';

/**
 * Categories and brands, through the API.
 *
 * ## Two rules the console no longer has to remember
 *
 * **A rename is not just a rename.** Renaming a category rewrites its own
 * `path`/`depth` and every descendant's, rewrites the `category` snapshot on
 * every product in the subtree, and invalidates the fifteen-minute cache. The
 * Supabase version updated one row, so every product card kept showing the old
 * name until something else happened to rewrite it — and nothing else did.
 *
 * **A reparent can be illegal.** A category cannot become its own parent or
 * move underneath one of its own descendants: a cycle makes `path[]`
 * unwritable, and every tree read afterwards either loops or silently drops the
 * branch. The API checks that, and checks the depth limit against the DEEPEST
 * descendant rather than against the category being moved. None of that was
 * checked before.
 *
 * ## Deleting is refused rather than cascading
 *
 * `409 CATEGORY_NOT_EMPTY` while products or live subcategories still point at
 * it, with both counts in the message so the refusal is a work list. A cascade
 * was rejected at the API: it would soft-delete a subtree in one click with no
 * way for the operator to know what went with it, and every product left behind
 * would be filed under a category that renders nowhere.
 *
 * A brand deletion is the opposite and deliberately so: it UN-BRANDS its
 * products rather than refusing, because a brand is optional on a product and a
 * product without one is a legitimate state.
 */

export interface TaxonomyActionResult<T> {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  entity?: T;
}

export type CategoryActionResult = TaxonomyActionResult<AdminCategory>;
export type BrandActionResult = TaxonomyActionResult<AdminBrand>;

export interface CategoryInput {
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  parentId: string;
  sortOrder: string;
  isActive: boolean;
}

export interface BrandInput {
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  website: string;
  isActive: boolean;
}

function orNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';

  return trimmed === '' ? null : trimmed;
}

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
 * Every screen that shows a category or brand name.
 *
 * A rename rewrites product snapshots, so the product list and the dashboard
 * are stale too — not only the taxonomy screen the operator is looking at.
 */
function revalidateTaxonomy(): void {
  // Route paths, not URLs — `basePath` is not part of them.
  for (const path of ['/categories', '/brands', '/products', '/inventory', '/']) {
    revalidatePath(path);
  }

  refresh();
}

function categoryBody(input: CategoryInput) {
  const sortOrder = Number.parseInt(input.sortOrder, 10);

  return {
    slug: input.slug.trim(),
    name: { en: input.nameEn.trim(), ar: orNull(input.nameAr) },
    description:
      orNull(input.descriptionEn) === null
        ? null
        : { en: input.descriptionEn.trim(), ar: orNull(input.descriptionAr) },
    // '' means "make it a root", which is a real instruction and not an
    // omission — so it maps to an explicit null rather than being dropped.
    parentId: orNull(input.parentId),
    ...(Number.isFinite(sortOrder) ? { sortOrder } : {}),
    isActive: input.isActive,
  };
}

export async function createCategoryAction(input: CategoryInput): Promise<CategoryActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.createCategory(categoryBody(input)));

  if (!res.ok) {
    return { ok: false, error: operatorMessage(res.error), fieldErrors: fieldErrorsFrom(res.error) };
  }

  revalidateTaxonomy();

  return { ok: true, entity: res.data.data };
}

export async function updateCategoryAction(
  id: string,
  input: CategoryInput,
): Promise<CategoryActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.updateCategory(id, categoryBody(input)));

  if (!res.ok) {
    return { ok: false, error: operatorMessage(res.error), fieldErrors: fieldErrorsFrom(res.error) };
  }

  revalidateTaxonomy();

  return { ok: true, entity: res.data.data };
}

export async function deleteCategoryAction(id: string): Promise<CategoryActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.deleteCategory(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateTaxonomy();

  return { ok: true, entity: res.data.data };
}

export async function restoreCategoryAction(id: string): Promise<CategoryActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.restoreCategory(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateTaxonomy();

  return { ok: true, entity: res.data.data };
}

function brandBody(input: BrandInput) {
  return {
    slug: input.slug.trim(),
    name: { en: input.nameEn.trim(), ar: orNull(input.nameAr) },
    description:
      orNull(input.descriptionEn) === null
        ? null
        : { en: input.descriptionEn.trim(), ar: orNull(input.descriptionAr) },
    website: orNull(input.website),
    isActive: input.isActive,
  };
}

export async function createBrandAction(input: BrandInput): Promise<BrandActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.createBrand(brandBody(input)));

  if (!res.ok) {
    return { ok: false, error: operatorMessage(res.error), fieldErrors: fieldErrorsFrom(res.error) };
  }

  revalidateTaxonomy();

  return { ok: true, entity: res.data.data };
}

export async function updateBrandAction(id: string, input: BrandInput): Promise<BrandActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.updateBrand(id, brandBody(input)));

  if (!res.ok) {
    return { ok: false, error: operatorMessage(res.error), fieldErrors: fieldErrorsFrom(res.error) };
  }

  revalidateTaxonomy();

  return { ok: true, entity: res.data.data };
}

export async function deleteBrandAction(id: string): Promise<BrandActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.deleteBrand(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateTaxonomy();

  return { ok: true, entity: res.data.data };
}

export async function restoreBrandAction(id: string): Promise<BrandActionResult> {
  await requireAdminActor();

  const res = await tryApi(() => api.restoreBrand(id));

  if (!res.ok) return { ok: false, error: operatorMessage(res.error) };

  revalidateTaxonomy();

  return { ok: true, entity: res.data.data };
}
