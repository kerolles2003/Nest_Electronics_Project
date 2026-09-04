'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@nest/ui';
import {
  createProductAction,
  updateProductAction,
  publishProductAction,
  unpublishProductAction,
  type ProductFormInput,
} from '@/actions/product.actions';
import { ProductSpecsEditor, emptySpec, type SpecRow } from './ProductSpecsEditor';
import { ProductImageManager } from './ProductImageManager';
import type { AdminBrand, AdminCategory, AdminProduct } from '@/lib/api/types';
import {
  Package, DollarSign, Tag, Image as ImageIcon, Search, CheckCircle2,
  AlertCircle, Loader2, Ruler, FileText, Eye, EyeOff, HelpCircle, Boxes,
} from 'lucide-react';

/**
 * The product editor, on the API.
 *
 * ## Four things the old form could do that this one refuses to
 *
 * **Set stock.** `stock_quantity` was a field on the form and went straight
 * into the row. The API rejects `stock` with a 400: InventoryModule is the sole
 * writer because every movement must produce a ledger entry, and a product form
 * that could set a balance is legacy defect M7 exactly — an admin moving stock
 * with nothing recording it. Stock is shown here, read-only, with a link to the
 * screen that can move it.
 *
 * **Publish on save.** `is_active` was a checkbox in the middle of the form.
 * Publishing is now `POST /publish`, a separately audited action, because "who
 * made this visible to customers" is a different question from "who edited the
 * description" and a boolean inside an update cannot answer it. A new product
 * is created unpublished — it has no images and no stock yet, and putting a
 * bare row into search results at the instant it is named helps nobody.
 *
 * **Attach images at create time.** An upload needs an entity id, and a product
 * that does not exist yet has none. So the create form says images come after
 * the first save, and the edit form has the manager. That is the API's shape
 * showing through, and pretending otherwise would mean holding files in memory
 * across a navigation and failing halfway.
 *
 * **Edit the SKU.** Immutable after creation (CATALOG-MODEL.md §2): it is the
 * warehouse identifier, printed on labels and quoted in supplier
 * correspondence.
 *
 * ## Prices are typed in EGP and stored in piastres
 *
 * The conversion is in `product.actions.ts`, once, at the edge. Not here: a
 * money conversion inside a re-render is a rounding bug waiting for a
 * keystroke.
 *
 * ## The slug check fails closed
 *
 * `/api/check-slug` answers `available: null` when it cannot reach the API, and
 * this form renders that as *unknown* — neither a tick nor a cross. The Supabase
 * route it replaced answered "free" on every failure path, and the form trusted
 * it, so an operator filled in a whole product and lost it to a unique-index
 * violation on save.
 */

interface ProductFormProps {
  mode: 'create' | 'edit';
  categories: AdminCategory[];
  brands: AdminBrand[];
  product?: AdminProduct;
}

/** Minor units → the EGP string the input shows. `null` stays empty, never "0". */
function toEgp(minor: number | null | undefined): string {
  return minor === null || minor === undefined ? '' : (minor / 100).toFixed(2);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function initialInput(product?: AdminProduct): ProductFormInput {
  return {
    sku: product?.sku ?? '',
    slug: product?.slug ?? '',
    nameEn: product?.name.en ?? '',
    nameAr: product?.name.ar ?? '',
    shortDescriptionEn: product?.shortDescription?.en ?? '',
    shortDescriptionAr: product?.shortDescription?.ar ?? '',
    descriptionEn: product?.description?.en ?? '',
    descriptionAr: product?.description?.ar ?? '',
    categoryId: product?.category.id ?? '',
    brandId: product?.brand?.id ?? '',
    basePrice: toEgp(product?.pricing.basePrice),
    salePrice: toEgp(product?.pricing.salePrice),
    costPrice: toEgp(product?.pricing.costPrice),
    weight: product?.weight === null || product?.weight === undefined ? '' : String(product.weight),
    length: product?.dimensions === null || product?.dimensions === undefined ? '' : String(product.dimensions.length),
    width: product?.dimensions === null || product?.dimensions === undefined ? '' : String(product.dimensions.width),
    height: product?.dimensions === null || product?.dimensions === undefined ? '' : String(product.dimensions.height),
    seoTitle: product?.seoTitle ?? '',
    seoDescription: product?.seoDescription ?? '',
    isFeatured: product?.isFeatured ?? false,
    specs: (product?.specs ?? []).map((spec) => ({
      key: spec.key,
      label: spec.label,
      value: spec.value,
      unit: spec.unit ?? '',
      filterable: spec.filterable,
    })),
  };
}

type SlugStatus = 'idle' | 'checking' | 'free' | 'taken' | 'unknown';

/** An answer, and the slug it was an answer ABOUT — so a stale reply cannot be shown as current. */
interface SlugCheck {
  slug: string;
  available: boolean | null;
  suggestion: string | null;
}

export function ProductForm({ mode, categories, brands, product }: ProductFormProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [form, setForm] = useState<ProductFormInput>(() => initialInput(product));
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [slugCheck, setSlugCheck] = useState<SlugCheck | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [isPublishing, startPublishing] = useTransition();

  const set = <K extends keyof ProductFormInput>(key: K, value: ProductFormInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  /*
   * The slug follows the name until somebody edits the slug — and it is derived
   * in the CHANGE HANDLER, not in an effect. An effect that mirrors one piece
   * of state into another renders twice for every keystroke and briefly shows a
   * slug that does not match the name it came from.
   */
  const changeName = (nameEn: string) => {
    setForm((current) => (slugTouched ? { ...current, nameEn } : { ...current, nameEn, slug: slugify(nameEn) }));
  };

  const slug = form.slug.trim();

  /*
   * Whether asking is even meaningful, derived rather than stored. On edit an
   * unchanged slug is not checked at all — `excludeId` would make the answer
   * "free", which is true and useless, and one fewer request per keystroke on
   * every product edit is worth having.
   */
  const slugCheckable = slug.length >= 2 && !(mode === 'edit' && slug === product?.slug);

  /*
   * The effect owns the REQUEST and nothing else. Every `setState` below runs
   * inside a timer or a promise callback, never synchronously in the effect
   * body, so there is no cascading render — and the status the form shows is
   * derived from whether the answer in hand is for the slug currently typed.
   */
  useEffect(() => {
    if (!slugCheckable) return;

    const params = new URLSearchParams({ type: 'product', slug });
    if (product !== undefined) params.set('excludeId', product.id);

    const timer = setTimeout(() => {
      void fetch(`/api/check-slug?${params.toString()}`)
        .then((response) => response.json())
        .then((data: { available: boolean | null; suggestion: string | null }) => {
          /*
           * `null` is UNKNOWN, and is rendered as unknown. Treating it as
           * "free" is the defect the replaced route had; treating it as
           * "taken" would block a save for a reason that may not exist.
           */
          setSlugCheck({ slug, available: data.available, suggestion: data.suggestion });
        })
        .catch(() => {
          setSlugCheck({ slug, available: null, suggestion: null });
        });
    }, 400);

    return () => clearTimeout(timer);
  }, [slug, slugCheckable, product]);

  const answered = slugCheck !== null && slugCheck.slug === slug;
  const slugStatus: SlugStatus = !slugCheckable
    ? 'idle'
    : !answered
      ? 'checking'
      : slugCheck.available === null
        ? 'unknown'
        : slugCheck.available
          ? 'free'
          : 'taken';
  const slugSuggestion = answered ? slugCheck.suggestion : null;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    startSaving(async () => {
      const result =
        mode === 'create'
          ? await createProductAction(form)
          : await updateProductAction(product?.id ?? '', form);

      if (!result.ok) {
        setFormError(result.error ?? 'The product was not saved.');
        setFieldErrors(result.fieldErrors ?? {});
        addToast(result.error ?? 'The product was not saved.', 'error');
        return;
      }

      if (mode === 'create' && result.product !== undefined) {
        /*
         * Straight to the edit page rather than back to the list. The product
         * exists but has no images and no stock, and both of those live here —
         * dropping the operator on a table would make them find it again.
         */
        addToast('Product created as a draft. Add images and stock, then publish.', 'success');
        router.push(`/products/${result.product.id}/edit`);
        return;
      }

      addToast('Product saved', 'success');
      router.refresh();
    });
  };

  const togglePublish = () => {
    if (product === undefined) return;

    startPublishing(async () => {
      const result = product.isActive
        ? await unpublishProductAction(product.id)
        : await publishProductAction(product.id);

      if (!result.ok) {
        addToast(result.error ?? 'The change was not applied.', 'error');
        return;
      }

      addToast(product.isActive ? 'Product unpublished' : 'Product published', 'success');
      router.refresh();
    });
  };

  const deleted = product?.deletedAt !== null && product?.deletedAt !== undefined;

  return (
    <form onSubmit={submit} className="flex flex-col items-start gap-6 xl:flex-row">
      {/* LEFT — the product itself */}
      <div className="w-full min-w-0 flex-1 space-y-5">
        {deleted && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-bold text-destructive">This product is deleted</p>
            <p className="mt-1 text-xs text-muted-foreground">
              It is hidden from the storefront and still holds its SKU and slug. Restore it from the
              catalogue&apos;s <span className="font-semibold">Deleted</span> tab before editing.
            </p>
          </div>
        )}

        <SectionCard title="Identity" icon={Package}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <FieldLabel required>Name (English)</FieldLabel>
              <input
                value={form.nameEn}
                onChange={(event) => changeName(event.target.value)}
                required
                maxLength={200}
                placeholder="ESP32 DevKit V1"
                className={inputClass(fieldErrors['name.en'])}
              />
              <FieldError message={fieldErrors['name.en']} />
            </div>

            <div className="md:col-span-2">
              <FieldLabel>Name (Arabic)</FieldLabel>
              <input
                value={form.nameAr}
                onChange={(event) => set('nameAr', event.target.value)}
                maxLength={200}
                dir="rtl"
                placeholder="اسم المنتج"
                className={`${inputClass(fieldErrors['name.ar'])} text-right`}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {/*
                  Both languages are editable because the editor sees the raw
                  pair. A form bound to a locale-resolved string would write the
                  resolved value back into whichever field the locale happened
                  to pick, quietly overwriting the Arabic name with the English.
                */}
                Optional. Shown on the Arabic storefront.
              </p>
            </div>

            <div>
              <FieldLabel required>SKU</FieldLabel>
              <input
                value={form.sku}
                onChange={(event) => set('sku', event.target.value.toUpperCase())}
                required={mode === 'create'}
                readOnly={mode === 'edit'}
                maxLength={64}
                placeholder="ESP32-WROOM-32"
                className={`${inputClass(fieldErrors['sku'])} font-mono ${mode === 'edit' ? 'cursor-not-allowed bg-muted text-muted-foreground' : ''}`}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {mode === 'edit'
                  ? 'Immutable. It is printed on labels and quoted to suppliers.'
                  : 'Uppercase. Permanent once saved.'}
              </p>
              <FieldError message={fieldErrors['sku']} />
            </div>

            <div>
              <FieldLabel required>Slug</FieldLabel>
              <div className="relative">
                <input
                  value={form.slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    set('slug', event.target.value);
                  }}
                  required
                  placeholder="esp32-devkit-v1"
                  className={`${inputClass(fieldErrors['slug'])} pr-9 font-mono`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <SlugIndicator status={slugStatus} />
                </span>
              </div>
              <SlugHint
                status={slugStatus}
                suggestion={slugSuggestion}
                onUse={(value) => {
                  setSlugTouched(true);
                  set('slug', value);
                }}
              />
              <FieldError message={fieldErrors['slug']} />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Description" icon={FileText}>
          <div className="space-y-4">
            <div>
              <FieldLabel>Short description (English)</FieldLabel>
              <textarea
                value={form.shortDescriptionEn}
                onChange={(event) => set('shortDescriptionEn', event.target.value)}
                rows={2}
                maxLength={5000}
                placeholder="A 38-pin ESP32 development board."
                className={textareaClass}
              />
            </div>
            <div>
              <FieldLabel>Short description (Arabic)</FieldLabel>
              <textarea
                value={form.shortDescriptionAr}
                onChange={(event) => set('shortDescriptionAr', event.target.value)}
                rows={2}
                maxLength={5000}
                dir="rtl"
                className={`${textareaClass} text-right`}
              />
            </div>
            <div>
              <FieldLabel>Full description (English)</FieldLabel>
              <textarea
                value={form.descriptionEn}
                onChange={(event) => set('descriptionEn', event.target.value)}
                rows={6}
                maxLength={5000}
                className={textareaClass}
              />
            </div>
            <div>
              <FieldLabel>Full description (Arabic)</FieldLabel>
              <textarea
                value={form.descriptionAr}
                onChange={(event) => set('descriptionAr', event.target.value)}
                rows={6}
                maxLength={5000}
                dir="rtl"
                className={`${textareaClass} text-right`}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Specifications" icon={Tag}>
          <ProductSpecsEditor specs={form.specs as SpecRow[]} onChange={(specs) => set('specs', specs)} />
          {form.specs.length === 0 && (
            <button
              type="button"
              onClick={() => set('specs', [emptySpec()])}
              className="sr-only"
              aria-hidden
            />
          )}
        </SectionCard>

        {mode === 'edit' && product !== undefined ? (
          <SectionCard title="Images" icon={ImageIcon}>
            <ProductImageManager product={product} />
          </SectionCard>
        ) : (
          <SectionCard title="Images" icon={ImageIcon}>
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              {/*
                Not a limitation worth hiding. An upload is filed under the
                product it belongs to, so it needs a product id — which does not
                exist until this form is saved once.
              */}
              Images are added after the first save. An upload is filed under the product it belongs
              to, so the product has to exist first.
            </p>
          </SectionCard>
        )}

        <SectionCard title="Shipping" icon={Ruler}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <FieldLabel>Weight (g)</FieldLabel>
              <input
                type="number"
                min={0}
                step={1}
                value={form.weight}
                onChange={(event) => set('weight', event.target.value)}
                className={inputClass(fieldErrors['weight'])}
              />
            </div>
            <div>
              <FieldLabel>Length (mm)</FieldLabel>
              <input
                type="number"
                min={0}
                step={1}
                value={form.length}
                onChange={(event) => set('length', event.target.value)}
                className={inputClass(fieldErrors['dimensions.length'])}
              />
            </div>
            <div>
              <FieldLabel>Width (mm)</FieldLabel>
              <input
                type="number"
                min={0}
                step={1}
                value={form.width}
                onChange={(event) => set('width', event.target.value)}
                className={inputClass(fieldErrors['dimensions.width'])}
              />
            </div>
            <div>
              <FieldLabel>Height (mm)</FieldLabel>
              <input
                type="number"
                min={0}
                step={1}
                value={form.height}
                onChange={(event) => set('height', event.target.value)}
                className={inputClass(fieldErrors['dimensions.height'])}
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            All three dimensions are needed for any of them to be stored — a box with two
            measurements is not a box.
          </p>
        </SectionCard>

        <SectionCard title="Search engine listing" icon={Search}>
          <div className="space-y-4">
            <div>
              <FieldLabel>SEO title</FieldLabel>
              <input
                value={form.seoTitle}
                onChange={(event) => set('seoTitle', event.target.value)}
                maxLength={70}
                className={inputClass(fieldErrors['seo.title'])}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {form.seoTitle.length}/70. Falls back to the product name when blank.
              </p>
            </div>
            <div>
              <FieldLabel>SEO description</FieldLabel>
              <textarea
                value={form.seoDescription}
                onChange={(event) => set('seoDescription', event.target.value)}
                rows={3}
                maxLength={200}
                className={textareaClass}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{form.seoDescription.length}/200</p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* RIGHT — the sidebar */}
      <div className="w-full space-y-5 xl:w-80 xl:shrink-0">
        <SectionCard title="Save" icon={CheckCircle2}>
          {formError !== null && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving || deleted}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {mode === 'create' ? 'Create as draft' : 'Save changes'}
          </button>

          {mode === 'create' && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              New products are created unpublished. They have no images and no stock yet, and a bare
              row in a customer&apos;s search results helps nobody.
            </p>
          )}

          <Link
            href="/products"
            className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-border px-4 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Back to catalogue
          </Link>
        </SectionCard>

        {mode === 'edit' && product !== undefined && !deleted && (
          <SectionCard title="Visibility" icon={product.isActive ? Eye : EyeOff}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">
                  {product.isActive ? 'Published' : 'Draft'}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {product.isActive
                    ? 'Visible to customers now.'
                    : 'Hidden from the storefront.'}
                </p>
              </div>
              <button
                type="button"
                onClick={togglePublish}
                disabled={isPublishing}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50 ${
                  product.isActive
                    ? 'bg-muted text-foreground hover:bg-surface-high'
                    : 'bg-success/15 text-success hover:bg-success/25'
                }`}
              >
                {isPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {product.isActive ? 'Unpublish' : 'Publish'}
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Publishing is recorded separately from an edit, so the trail can answer
              &ldquo;who made this visible, and when&rdquo;.
            </p>
          </SectionCard>
        )}

        <SectionCard title="Pricing" icon={DollarSign}>
          <div className="space-y-4">
            <div>
              <FieldLabel required>Base price (EGP)</FieldLabel>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.basePrice}
                onChange={(event) => set('basePrice', event.target.value)}
                required
                className={inputClass(fieldErrors['basePrice'])}
              />
              <FieldError message={fieldErrors['basePrice']} />
            </div>
            <div>
              <FieldLabel>Sale price (EGP)</FieldLabel>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.salePrice}
                onChange={(event) => set('salePrice', event.target.value)}
                className={inputClass(fieldErrors['salePrice'])}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Must be below the base price. Clear it to end the sale.
              </p>
              <FieldError message={fieldErrors['salePrice']} />
            </div>
            <div>
              <FieldLabel>Cost price (EGP)</FieldLabel>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.costPrice}
                onChange={(event) => set('costPrice', event.target.value)}
                className={inputClass(fieldErrors['costPrice'])}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {/*
                  Worth stating on the screen. The separation is structural: a
                  different DTO type, not a runtime field-strip.
                */}
                Never leaves the admin. It is absent from every public response by construction.
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Placement" icon={Tag}>
          <div className="space-y-4">
            <div>
              <FieldLabel required>Category</FieldLabel>
              <select
                value={form.categoryId}
                onChange={(event) => set('categoryId', event.target.value)}
                required
                className={selectClass(fieldErrors['categoryId'])}
              >
                <option value="">Choose a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {'— '.repeat(category.depth)}
                    {category.name.en}
                  </option>
                ))}
              </select>
              <FieldError message={fieldErrors['categoryId']} />
            </div>
            <div>
              <FieldLabel>Brand</FieldLabel>
              <select
                value={form.brandId}
                onChange={(event) => set('brandId', event.target.value)}
                className={selectClass(fieldErrors['brandId'])}
              >
                <option value="">No brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name.en}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.isFeatured}
                onChange={(event) => set('isFeatured', event.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Featured
            </label>
          </div>
        </SectionCard>

        {mode === 'edit' && product !== undefined && (
          <SectionCard title="Stock" icon={Boxes}>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {product.stock.onHand}
              </span>
              <span className="text-xs text-muted-foreground">
                reorder at {product.stock.lowStockThreshold}
              </span>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {/*
                The refusal explained where somebody would look for the field.
              */}
              Read-only here. Stock moves only through an inventory adjustment, which records a
              ledger entry in the same transaction — a product form that could set a balance would
              move stock with nothing recording it.
            </p>
            <Link
              href="/inventory"
              className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Adjust stock
            </Link>
          </SectionCard>
        )}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                               */
/* ------------------------------------------------------------------ */

const baseInput =
  'h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/10';

const textareaClass =
  'w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-all focus:ring-2 focus:ring-primary/10';

function inputClass(error: string | undefined): string {
  return `${baseInput} ${error === undefined ? 'border-border focus:border-primary/30' : 'border-destructive'}`;
}

function selectClass(error: string | undefined): string {
  return `${inputClass(error)} appearance-none`;
}

function SectionCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted-foreground">
      {children}
      {required === true && <span className="ml-0.5 text-destructive">*</span>}
    </span>
  );
}

function FieldError({ message }: { message: string | undefined }) {
  if (message === undefined) return null;

  return <p className="mt-1 text-[11px] font-medium text-destructive">{message}</p>;
}

function SlugIndicator({ status }: { status: SlugStatus }) {
  if (status === 'checking') return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  if (status === 'free') return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
  if (status === 'taken') return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === 'unknown') return <HelpCircle className="h-3.5 w-3.5 text-warning" />;

  return null;
}

/**
 * The three answers, and the third is the one that matters.
 *
 * "Unknown" is rendered as unknown — not as free, which is what the replaced
 * Supabase route said on every failure path, and not as taken, which would
 * block a save for a reason that may not exist.
 */
function SlugHint({
  status,
  suggestion,
  onUse,
}: {
  status: SlugStatus;
  suggestion: string | null;
  onUse: (slug: string) => void;
}) {
  if (status === 'taken') {
    return (
      <p className="mt-1 text-[11px] font-medium text-destructive">
        Taken.{' '}
        {suggestion !== null && (
          <button type="button" onClick={() => onUse(suggestion)} className="underline hover:no-underline">
            Use {suggestion}
          </button>
        )}
      </p>
    );
  }

  if (status === 'unknown') {
    return (
      <p className="mt-1 text-[11px] font-medium text-warning">
        Could not check — saving may still be refused as a duplicate.
      </p>
    );
  }

  if (status === 'free') {
    return <p className="mt-1 text-[11px] font-medium text-success">Available.</p>;
  }

  return null;
}
