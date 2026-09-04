'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@nest/ui';
import {
  createCategoryAction,
  updateCategoryAction,
  deleteCategoryAction,
  restoreCategoryAction,
  type CategoryInput,
} from '@/actions/category-brand.actions';
import type { AdminCategory } from '@/lib/api/types';
import {
  Plus, Pencil, Trash2, RotateCcw, Loader2, X, AlertTriangle, FolderTree, Eye, EyeOff,
} from 'lucide-react';

/**
 * Categories, on the API.
 *
 * ## Three things the operator now sees that the Supabase screen hid
 *
 * **A rename is a subtree operation.** It rewrites this category's `path` and
 * `depth`, every descendant's, and the `category` snapshot on every product in
 * the subtree. The old screen updated one row and every product card kept
 * showing the old name indefinitely. The dialog says so before saving.
 *
 * **A delete is refused rather than cascading.** `409 CATEGORY_NOT_EMPTY` names
 * how many products and how many live subcategories still point at it, so the
 * refusal is a work list rather than a wall. The message is shown verbatim.
 *
 * **Deleted categories are listed and restorable.** The delete keeps the slug
 * reserved — reusing it would repoint existing links — so a deleted category is
 * shown, greyed, with a Restore action rather than vanishing and taking its
 * name with it.
 *
 * ## `depth` is the tree
 *
 * The API returns a FLAT list, shallowest first, each row carrying its own
 * `parentId`, `path` and `depth`. Indentation is `depth`, not a client-side
 * recursion over `children` — there is no `children` on the wire, and building
 * one here would be reconstructing what the server already resolved.
 */

interface CategoriesManagerProps {
  categories: AdminCategory[];
}

function emptyInput(parentId = ''): CategoryInput {
  return {
    slug: '',
    nameEn: '',
    nameAr: '',
    descriptionEn: '',
    descriptionAr: '',
    parentId,
    sortOrder: '0',
    isActive: true,
  };
}

function toInput(category: AdminCategory): CategoryInput {
  return {
    slug: category.slug,
    nameEn: category.name.en,
    nameAr: category.name.ar ?? '',
    descriptionEn: category.description?.en ?? '',
    descriptionAr: category.description?.ar ?? '',
    parentId: category.parentId ?? '',
    sortOrder: String(category.sortOrder),
    isActive: category.isActive,
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

/** The maximum depth the API allows. Stated so a disabled parent option is explicable. */
const MAX_DEPTH = 3;

export function CategoriesManager({ categories }: CategoriesManagerProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [editing, setEditing] = useState<{ id: string | null; input: CategoryInput } | null>(null);
  const [confirming, setConfirming] = useState<AdminCategory | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const live = categories.filter((category) => category.deletedAt === null);
  const deleted = categories.filter((category) => category.deletedAt !== null);

  const refresh = () => {
    startTransition(() => {
      router.refresh();
    });
  };

  const remove = (category: AdminCategory) => {
    setBusyId(category.id);
    void deleteCategoryAction(category.id).then((result) => {
      setBusyId(null);
      setConfirming(null);

      if (!result.ok) {
        // The API's own message names both counts. Shown verbatim: a generic
        // "could not delete" would throw away the work list it contains.
        addToast(result.error ?? 'The category was not deleted.', 'error');
        return;
      }

      addToast('Category deleted. It can be restored.', 'success');
      refresh();
    });
  };

  const restore = (category: AdminCategory) => {
    setBusyId(category.id);
    void restoreCategoryAction(category.id).then((result) => {
      setBusyId(null);

      if (!result.ok) {
        addToast(result.error ?? 'The category was not restored.', 'error');
        return;
      }

      addToast('Category restored — inactive, so publish it when it is ready.', 'success');
      refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Stat label="Categories" value={live.length} />
          <Stat label="Published" value={live.filter((c) => c.isActive).length} />
          <Stat label="Roots" value={live.filter((c) => c.parentId === null).length} />
          {deleted.length > 0 && <Stat label="Deleted" value={deleted.length} />}
        </div>
        <button
          type="button"
          onClick={() => setEditing({ id: null, input: emptyInput() })}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <Plus className="h-4 w-4" /> New category
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {categories.length === 0 ? (
          <div className="p-12 text-center">
            <FolderTree className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <h3 className="text-base font-bold text-foreground">No categories yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every product belongs to one, so the catalogue starts here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {categories.map((category) => {
              const isDeleted = category.deletedAt !== null;
              const busy = busyId === category.id;

              return (
                <li
                  key={category.id}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/20 ${isDeleted ? 'opacity-60' : ''}`}
                >
                  {/* Indentation IS depth. See the docstring. */}
                  <div className="min-w-0 flex-1" style={{ paddingLeft: `${String(category.depth * 20)}px` }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{category.name.en}</span>
                      {category.name.ar !== null && (
                        <span className="text-xs text-muted-foreground" dir="rtl">
                          {category.name.ar}
                        </span>
                      )}
                      {isDeleted ? (
                        <Chip tone="destructive">Deleted</Chip>
                      ) : category.isActive ? (
                        <Chip tone="success">Published</Chip>
                      ) : (
                        <Chip tone="muted">Hidden</Chip>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3">
                      <span className="font-mono text-[11px] text-muted-foreground">{category.slug}</span>
                      <Link
                        href={`/products?category=${category.id}`}
                        className="text-[11px] text-muted-foreground hover:text-primary hover:underline"
                      >
                        {category.productCount} product{category.productCount === 1 ? '' : 's'}
                      </Link>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}

                    {isDeleted ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => restore(category)}
                        className="inline-flex items-center gap-1 rounded-lg bg-success/10 px-2.5 py-1.5 text-[11px] font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing({ id: category.id, input: toInput(category) })}
                          className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirming(category)}
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          aria-label="Delete category"
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
        <CategoryDialog
          categories={live}
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
        <ConfirmDeleteCategory
          category={confirming}
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
      <span className="font-bold text-foreground tabular-nums">{value}</span>{' '}
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

function CategoryDialog({
  categories,
  id,
  initial,
  onClose,
  onSaved,
}: {
  categories: AdminCategory[];
  id: string | null;
  initial: CategoryInput;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { addToast } = useToast();
  const [form, setForm] = useState<CategoryInput>(initial);
  const [slugTouched, setSlugTouched] = useState(id !== null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const set = <K extends keyof CategoryInput>(key: K, value: CategoryInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const changeName = (nameEn: string) => {
    setForm((current) => (slugTouched ? { ...current, nameEn } : { ...current, nameEn, slug: slugify(nameEn) }));
  };

  /*
   * A category cannot be its own parent, and cannot move underneath one of its
   * own descendants — a cycle makes `path[]` unwritable. The API refuses both;
   * they are removed from the picker so the operator is not offered a choice
   * that will be rejected. `path` includes every ancestor, so "is a descendant
   * of me" is a membership test rather than a walk.
   */
  const parentOptions = categories.filter(
    (category) =>
      category.id !== id &&
      !(id !== null && category.path.includes(id)) &&
      category.depth < MAX_DEPTH - 1,
  );

  const reparenting = id !== null && form.parentId !== initial.parentId;
  const renaming = id !== null && (form.nameEn !== initial.nameEn || form.slug !== initial.slug);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    startSaving(async () => {
      const result = id === null
        ? await createCategoryAction(form)
        : await updateCategoryAction(id, form);

      if (!result.ok) {
        setError(result.error ?? 'The category was not saved.');
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }

      addToast(id === null ? 'Category created' : 'Category saved', 'success');
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
            {id === null ? 'New category' : 'Edit category'}
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
              value={form.slug}
              onChange={(event) => {
                setSlugTouched(true);
                set('slug', event.target.value);
              }}
              required
              className={`${fieldClass(fieldErrors['slug'])} font-mono`}
            />
          </Field>

          <Field label="Parent" error={fieldErrors['parentId']}>
            <select
              value={form.parentId}
              onChange={(event) => set('parentId', event.target.value)}
              className={`${fieldClass(fieldErrors['parentId'])} appearance-none`}
            >
              <option value="">No parent (a root category)</option>
              {parentOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {'— '.repeat(category.depth)}
                  {category.name.en}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {/*
                Both exclusions explained, because an operator looking for a
                category that is missing from this list needs to know why.
              */}
              A category cannot be its own parent or move under one of its own
              subcategories, and the tree is at most {MAX_DEPTH} levels deep — those are left out
              of this list rather than refused on save.
            </p>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Sort order" error={fieldErrors['sortOrder']}>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(event) => set('sortOrder', event.target.value)}
                className={fieldClass(fieldErrors['sortOrder'])}
              />
            </Field>
            <div className="flex items-end pb-2">
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
            </div>
          </div>

          <Field label="Description (English)" error={fieldErrors['description.en']}>
            <textarea
              value={form.descriptionEn}
              onChange={(event) => set('descriptionEn', event.target.value)}
              rows={2}
              maxLength={5000}
              className={`${fieldClass(fieldErrors['description.en'])} h-auto resize-none py-2`}
            />
          </Field>

          {(renaming || reparenting) && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="text-foreground">
                {/*
                  Not a warning, a description. Saying what the save actually
                  does is the difference between an operator who trusts the
                  screen and one who checks the storefront afterwards.
                */}
                {reparenting
                  ? 'Moving this category rewrites the whole subtree beneath it and the category on every product in it.'
                  : 'Renaming rewrites the category shown on every product in this subtree, and leaves a redirect from the old slug.'}
              </span>
            </div>
          )}

          {error !== null && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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

function ConfirmDeleteCategory({
  category,
  onCancel,
  onConfirm,
}: {
  category: AdminCategory;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-elevated">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">Delete this category?</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{category.name.en}</p>
          </div>
        </div>

        <div className="space-y-2 px-5 py-4 text-sm text-foreground">
          <p>It can be restored, and its slug stays reserved while it is deleted.</p>
          <p className="text-xs text-muted-foreground">
            {/*
              The refusal is stated BEFORE it happens, so the operator knows
              what to do rather than meeting a 409 they have to interpret.
            */}
            Deleting is refused while any product or live subcategory still points at it — nothing
            is cascaded, so nothing disappears without being moved first.
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
