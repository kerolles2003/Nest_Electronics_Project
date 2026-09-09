'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@nest/ui';
import {
  createBrandAction,
  updateBrandAction,
  deleteBrandAction,
  restoreBrandAction,
  type BrandInput,
} from '@/actions/category-brand.actions';
import type { AdminBrand } from '@/lib/api/types';
import {
  Plus, Pencil, Trash2, RotateCcw, Loader2, X, AlertTriangle, Tag, ExternalLink, Eye, EyeOff,
} from 'lucide-react';

/**
 * Brands, on the API.
 *
 * ## Deleting a brand UN-BRANDS its products rather than refusing
 *
 * The opposite of the category rule, and deliberately so: a brand is optional
 * on a product, and a product without one is a legitimate state — whereas a
 * product without a category is not, which is why deleting a non-empty category
 * is refused. The confirmation says which of the two this is, and how many
 * products it affects, before the click.
 *
 * **Restore is not the inverse.** Restoring a brand does NOT re-brand the
 * products the deletion un-branded: re-attaching would need a record of which
 * products were attached, and nothing keeps one. Said on screen rather than
 * discovered.
 *
 * ## The logo is gone, and that is not an oversight
 *
 * The old screen had a `logo_url` field pointing at Supabase Storage. The API's
 * brand has no logo: media is reference-counted through the media pipeline, and
 * a brand logo would need its own attach/detach endpoints that do not exist. A
 * text field holding a URL nothing serves is worse than no field — so it is
 * absent, and the absence is recorded here.
 */

interface BrandsManagerProps {
  brands: AdminBrand[];
}

function emptyInput(): BrandInput {
  return {
    slug: '',
    nameEn: '',
    nameAr: '',
    descriptionEn: '',
    descriptionAr: '',
    website: '',
    isActive: true,
  };
}

function toInput(brand: AdminBrand): BrandInput {
  return {
    slug: brand.slug,
    nameEn: brand.name.en,
    nameAr: brand.name.ar ?? '',
    descriptionEn: brand.description?.en ?? '',
    descriptionAr: brand.description?.ar ?? '',
    website: brand.website ?? '',
    isActive: brand.isActive,
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function BrandsManager({ brands }: BrandsManagerProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [editing, setEditing] = useState<{ id: string | null; input: BrandInput } | null>(null);
  const [confirming, setConfirming] = useState<AdminBrand | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const live = brands.filter((brand) => brand.deletedAt === null);
  const deleted = brands.filter((brand) => brand.deletedAt !== null);

  const refresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const remove = (brand: AdminBrand) => {
    setBusyId(brand.id);
    void deleteBrandAction(brand.id).then((result) => {
      setBusyId(null);
      setConfirming(null);

      if (!result.ok) {
        addToast(result.error ?? 'The brand was not deleted.', 'error');
        return;
      }

      addToast(
        brand.productCount > 0
          ? `Brand deleted. ${String(brand.productCount)} product${brand.productCount === 1 ? '' : 's'} no longer have a brand.`
          : 'Brand deleted. It can be restored.',
        'success',
      );
      refresh();
    });
  };

  const restore = (brand: AdminBrand) => {
    setBusyId(brand.id);
    void restoreBrandAction(brand.id).then((result) => {
      setBusyId(null);

      if (!result.ok) {
        addToast(result.error ?? 'The brand was not restored.', 'error');
        return;
      }

      addToast('Brand restored — inactive, and its old products stay un-branded.', 'success');
      refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Stat label="Brands" value={live.length} />
          <Stat label="Published" value={live.filter((brand) => brand.isActive).length} />
          {deleted.length > 0 && <Stat label="Deleted" value={deleted.length} />}
        </div>
        <button
          type="button"
          onClick={() => setEditing({ id: null, input: emptyInput() })}
          data-testid="brand-new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" /> New brand
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {brands.length === 0 ? (
          <div className="p-12 text-center">
            <Tag className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <h3 className="text-base font-bold text-foreground">No brands yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A brand is optional on a product — add one when a manufacturer is worth naming.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {brands.map((brand) => {
              const isDeleted = brand.deletedAt !== null;
              const busy = busyId === brand.id;

              return (
                <li
                  key={brand.id}
                  data-testid="brand-row"
                  data-slug={brand.slug}
                  data-deleted={String(isDeleted)}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/20 ${isDeleted ? 'opacity-60' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span data-testid="brand-name" className="text-sm font-semibold text-foreground">
                        {brand.name.en}
                      </span>
                      {brand.name.ar !== null && (
                        <span className="text-xs text-muted-foreground" dir="rtl">
                          {brand.name.ar}
                        </span>
                      )}
                      {isDeleted ? (
                        <Chip tone="destructive">Deleted</Chip>
                      ) : brand.isActive ? (
                        <Chip tone="success">Published</Chip>
                      ) : (
                        <Chip tone="muted">Hidden</Chip>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3">
                      <span data-testid="brand-slug" className="font-mono text-[11px] text-muted-foreground">
                        {brand.slug}
                      </span>
                      <Link
                        href={`/products?brand=${brand.id}`}
                        className="text-[11px] text-muted-foreground hover:text-primary hover:underline"
                      >
                        {brand.productCount} product{brand.productCount === 1 ? '' : 's'}
                      </Link>
                      {brand.website !== null && (
                        <a
                          href={brand.website}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Website
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

                    {isDeleted ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => restore(brand)}
                        data-testid="brand-restore"
                        className="inline-flex items-center gap-1 rounded-lg bg-success/10 px-2.5 py-1.5 text-[11px] font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing({ id: brand.id, input: toInput(brand) })}
                          data-testid="brand-edit"
                          className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirming(brand)}
                          data-testid="brand-delete"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          aria-label="Delete brand"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isPending && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Refreshing...
        </p>
      )}

      {editing !== null && (
        <BrandDialog
          id={editing.id}
          initial={editing.input}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}

      {confirming !== null && (
        <ConfirmDeleteBrand
          brand={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => remove(confirming)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-lg border border-border bg-card px-2.5 py-1">
      <span className="font-bold tabular-nums text-foreground">{value}</span>{' '}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Chip({ tone, children }: { tone: 'success' | 'muted' | 'destructive'; children: React.ReactNode }) {
  const styles = {
    success: 'border-success/20 bg-success/10 text-success',
    muted: 'border-border bg-muted text-muted-foreground',
    destructive: 'border-destructive/20 bg-destructive/10 text-destructive',
  };

  return (
    <span className={`rounded-full border px-1.5 py-[1px] text-[10px] font-bold ${styles[tone]}`}>
      {children}
    </span>
  );
}

function BrandDialog({
  id,
  initial,
  onClose,
  onSaved,
}: {
  id: string | null;
  initial: BrandInput;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { addToast } = useToast();
  const [form, setForm] = useState<BrandInput>(initial);
  const [slugTouched, setSlugTouched] = useState(id !== null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const set = <K extends keyof BrandInput>(key: K, value: BrandInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const changeName = (nameEn: string) => {
    setForm((current) => (slugTouched ? { ...current, nameEn } : { ...current, nameEn, slug: slugify(nameEn) }));
  };

  const renaming = id !== null && (form.nameEn !== initial.nameEn || form.slug !== initial.slug);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    startSaving(async () => {
      const result = id === null ? await createBrandAction(form) : await updateBrandAction(id, form);

      if (!result.ok) {
        setError(result.error ?? 'The brand was not saved.');
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      addToast(id === null ? 'Brand created' : 'Brand saved', 'success');
      onSaved();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="my-8 w-full max-w-lg rounded-xl border border-border bg-card shadow-elevated"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-bold text-foreground">
            {id === null ? 'New brand' : 'Edit brand'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <Field label="Name (English)" required error={fieldErrors['name.en']}>
            <input
              data-testid="brand-field-name"
              value={form.nameEn}
              onChange={(event) => changeName(event.target.value)}
              required
              maxLength={200}
              className={fieldClass(fieldErrors['name.en'])}
            />
          </Field>

          <Field label="Name (Arabic)" error={fieldErrors['name.ar']}>
            <input
              value={form.nameAr}
              onChange={(event) => set('nameAr', event.target.value)}
              maxLength={200}
              dir="rtl"
              className={`${fieldClass(fieldErrors['name.ar'])} text-right`}
            />
          </Field>

          <Field label="Slug" required error={fieldErrors['slug']}>
            <input
              data-testid="brand-field-slug"
              value={form.slug}
              onChange={(event) => {
                setSlugTouched(true);
                set('slug', event.target.value);
              }}
              required
              className={`${fieldClass(fieldErrors['slug'])} font-mono`}
            />
          </Field>

          <Field label="Website" error={fieldErrors['website']}>
            <input
              type="url"
              value={form.website}
              onChange={(event) => set('website', event.target.value)}
              placeholder="https://www.espressif.com"
              className={fieldClass(fieldErrors['website'])}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              An absolute http(s) URL, or leave it blank.
            </p>
          </Field>

          <Field label="Description (English)" error={fieldErrors['description.en']}>
            <textarea
              value={form.descriptionEn}
              onChange={(event) => set('descriptionEn', event.target.value)}
              rows={2}
              maxLength={5000}
              className={`${fieldClass(fieldErrors['description.en'])} h-auto resize-none py-2`}
            />
          </Field>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            {form.isActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            Visible to customers
          </label>

          {renaming && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="text-foreground">
                Renaming rewrites the brand shown on every product carrying it, and leaves a
                redirect from the old slug.
              </span>
            </div>
          )}

          {error !== null && (
            <div
              role="alert"
              data-testid="brand-form-error"
              className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="brand-save"
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {id === null ? 'Create' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDeleteBrand({
  brand,
  onCancel,
  onConfirm,
}: {
  brand: AdminBrand;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-elevated">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">Delete this brand?</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{brand.name.en}</p>
          </div>
        </div>

        <div className="space-y-2 px-5 py-4 text-sm text-foreground">
          {brand.productCount > 0 ? (
            <p>
              {/*
                The consequence, with the number, before the click. Deleting a
                brand does not refuse — it edits products.
              */}
              <span className="font-semibold">{brand.productCount}</span> product
              {brand.productCount === 1 ? '' : 's'} will lose their brand. They stay published and
              keep everything else.
            </p>
          ) : (
            <p>No products carry this brand.</p>
          )}
          <p className="text-xs text-muted-foreground">
            It can be restored, and its slug stays reserved while it is deleted — but restoring does
            NOT re-brand the products this deletion un-brands. Nothing records which ones they were.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="brand-delete-confirm"
            className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-xs font-bold text-destructive-foreground transition-colors hover:bg-destructive/90"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

const fieldBase =
  'h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/10';

function fieldClass(error: string | undefined): string {
  return `${fieldBase} ${error === undefined ? 'border-border' : 'border-destructive'}`;
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {label}
        {required === true && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
      {error !== undefined && <p className="mt-1 text-[11px] font-medium text-destructive">{error}</p>}
    </div>
  );
}
