"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, useToast } from "@nest/ui";
import { createProductAction, updateProductAction, softDeleteProductAction, duplicateProductAction, createSlugRedirectAction } from "@/actions/product.actions";
import type { Product, Category, Brand } from "@nest/types";
import { ProductImageUpload } from "./ProductImageUpload";
import { AttributeEditor } from "./AttributeEditor";
import { productSchema } from "@nest/types";
import {
  Package, Info, DollarSign, Tag, Image as ImageIcon,
  Search, CheckCircle2, AlertCircle, Trash2, Eye,
  Weight, Ruler, FileText, Languages, Sparkles, Copy,
  ChevronRight, Loader2
} from "lucide-react";

interface ProductFormProps {
  mode: "create" | "edit";
  categories: Category[];
  brands: Brand[];
  initialData?: Product;
}

function flattenCategories(categories: Category[]): Category[] {
  const result: Category[] = [];
  for (const cat of categories) {
    result.push(cat);
    if (cat.children) {
      result.push(...flattenCategories(cat.children));
    }
  }
  return result;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(dateString: string | null) {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

/* ------------------------------------------------------------------ */
/*  Section Card                                                       */
/* ------------------------------------------------------------------ */

function SectionCard({
  title, icon: Icon, children, className = ""
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card shadow-sm ${className}`}>
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
      </div>
      <div className="p-5">
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Form Field Helpers                                                 */
/* ------------------------------------------------------------------ */

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
  );
}

function TextInput({
  name, defaultValue, value, onChange, placeholder, type = "text", required, min, step, maxLength, className = "", readOnly
}: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return (
    <input
      name={name}
      type={type}
      defaultValue={defaultValue}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      min={min}
      step={step}
      maxLength={maxLength}
      readOnly={readOnly}
      className={`h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 focus:border-primary/30 transition-all outline-none ${className}`}
    />
  );
}

function TextArea({
  name, defaultValue, rows = 4, placeholder, maxLength
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      name={name}
      defaultValue={defaultValue}
      rows={rows}
      placeholder={placeholder}
      maxLength={maxLength}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary/10 focus:border-primary/30 transition-all outline-none"
    />
  );
}

function SelectField({
  name, defaultValue, children
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 focus:border-primary/30 outline-none appearance-none"
    >
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function ProductForm({ mode, categories, brands, initialData }: ProductFormProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [slug, setSlug] = useState(initialData?.slug || "");
  const [nameEn, setNameEn] = useState(initialData?.name_en || "");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugChecking, setSlugChecking] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const slugDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [seoTitle, setSeoTitle] = useState(initialData?.seo_title || "");
  const [seoDesc, setSeoDesc] = useState(initialData?.seo_description || "");
  const [categoryId, setCategoryId] = useState(initialData?.category_id || "");
  const [isDuplicating, setIsDuplicating] = useState(false);

  const flatCategories = flattenCategories(categories);

  /* slug auto-generation */
  useEffect(() => {
    if (!slugManuallyEdited && nameEn && mode === "create") {
      setSlug(generateSlug(nameEn));
    }
  }, [nameEn, slugManuallyEdited, mode]);

  /* debounced slug availability check */
  useEffect(() => {
    if (!slug || mode === "edit" || slug.length < 2) {
      setSlugAvailable(null);
      return;
    }
    clearTimeout(slugDebounceRef.current);
    setSlugChecking(true);
    slugDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/check-slug?slug=${encodeURIComponent(slug)}`);
        const data = await res.json();
        setSlugAvailable(!data.exists);
      } catch {
        setSlugAvailable(null);
      } finally {
        setSlugChecking(false);
      }
    }, 400);
    return () => clearTimeout(slugDebounceRef.current);
  }, [slug, mode]);

  const handleNameChange = (value: string) => {
    setNameEn(value);
    if (!slugManuallyEdited && mode === "create") {
      setSlug(generateSlug(value));
    }
  };

  const validateForm = (formData: FormData): boolean => {
    const raw: Record<string, unknown> = {};
    formData.forEach((val, key) => {
      if (key === "base_price" || key === "sale_price" || key === "cost_price" || key === "stock_quantity" || key === "low_stock_threshold" || key === "weight") {
        raw[key] = val ? parseFloat(val as string) : undefined;
      } else if (key === "is_active" || key === "is_featured") {
        raw[key] = val === "on" || val === "true";
      } else {
        raw[key] = val || undefined;
      }
    });
    // Ensure booleans are set even if unchecked
    if (!formData.has("is_active")) raw["is_active"] = false;
    if (!formData.has("is_featured")) raw["is_featured"] = false;

    const parsed = productSchema.safeParse(raw);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as string;
        if (!errs[key]) errs[key] = issue.message;
      }
      setClientErrors(errs);
      return false;
    }
    setClientErrors({});
    return true;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    if (!formData.get("slug")) formData.set("slug", slug);

    if (!validateForm(formData)) {
      setIsSubmitting(false);
      addToast("Please fix the validation errors", "error");
      return;
    }

    selectedImages.forEach((file) => {
      formData.append("images", file);
    });

    // Handle slug redirect on edit
    if (mode === "edit" && initialData && initialData.slug !== slug) {
      await createSlugRedirectAction(initialData.slug, slug, "product");
    }

    const result =
      mode === "create"
        ? await createProductAction(formData)
        : await updateProductAction(formData);

    setIsSubmitting(false);

    if (result.success) {
      addToast(`Product ${mode === "create" ? "created" : "updated"} successfully!`, "success");
      router.push("/products");
    } else {
      addToast(result.error || "An error occurred", "error");
    }
  };

  const handleDuplicate = async () => {
    if (!initialData) return;
    setIsDuplicating(true);
    const result = await duplicateProductAction(initialData.id);
    setIsDuplicating(false);
    if (result.success && result.productId) {
      addToast("Product duplicated successfully", "success");
      router.push(`/products/${result.productId}/edit`);
    } else {
      addToast(result.error || "Duplicate failed", "error");
    }
  };

  const handleDelete = async () => {
    if (!initialData) return;
    if (!confirm("Are you sure you want to permanently delete this product?")) return;
    const result = await softDeleteProductAction(initialData.id);
    if (result.success) {
      addToast("Product deleted", "success");
      router.push("/products");
    } else {
      addToast(result.error || "Delete failed", "error");
    }
  };

  const discountPercent = useCallback(() => {
    const base = parseFloat((document.getElementById("base_price") as HTMLInputElement)?.value || "0");
    const sale = parseFloat((document.getElementById("sale_price") as HTMLInputElement)?.value || "0");
    if (!base || !sale || sale >= base) return 0;
    return Math.round(((base - sale) / base) * 100);
  }, []);

  const [liveDiscount, setLiveDiscount] = useState(0);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col xl:flex-row gap-6 items-start">
      {mode === "edit" && initialData && (
        <input type="hidden" name="id" value={initialData.id} />
      )}

      {/* LEFT COLUMN — Form Sections */}
      <div className="flex-1 w-full space-y-5 min-w-0">

        {/* 1. Basic Info */}
        <SectionCard title="Basic Information" icon={Package}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <FieldLabel required>Product Name (English)</FieldLabel>
              <TextInput
                name="name_en"
                value={nameEn}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Samsung Galaxy S24 Ultra"
                required
              />
              {clientErrors.name_en && <p className="text-[11px] text-destructive mt-1">{clientErrors.name_en}</p>}
            </div>

            <div className="md:col-span-2">
              <FieldLabel>Product Name (Arabic)</FieldLabel>
              <TextInput
                name="name_ar"
                defaultValue={initialData?.name_ar || ""}
                placeholder="اسم المنتج بالعربية"
                className="text-right"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Optional. Displayed on Arabic storefront.</p>
            </div>

            <div>
              <FieldLabel required>Public Slug</FieldLabel>
              <div className="relative">
                <TextInput
                  name="slug"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugManuallyEdited(true);
                  }}
                  placeholder="product-url-slug"
                  required
                  className="pr-8 font-mono text-xs"
                />
                {slugChecking && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
                {!slugChecking && slugAvailable === true && (
                  <CheckCircle2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-success" />
                )}
                {!slugChecking && slugAvailable === false && (
                  <AlertCircle className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-destructive" />
                )}
              </div>
              {clientErrors.slug && <p className="text-[11px] text-destructive mt-1">{clientErrors.slug}</p>}
              {slugAvailable === false && <p className="text-[11px] text-destructive mt-1">This slug is already taken</p>}
            </div>

            <div>
              <FieldLabel required>SKU</FieldLabel>
              <TextInput
                name="sku"
                defaultValue={initialData?.sku || ""}
                placeholder="SM-S928-BLK-256"
                required
                className="font-mono text-xs"
              />
              {clientErrors.sku && <p className="text-[11px] text-destructive mt-1">{clientErrors.sku}</p>}
            </div>

            <div>
              <FieldLabel>Category</FieldLabel>
              <select
                name="category_id"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm focus:ring-2 focus:ring-primary/10 focus:border-primary/30 outline-none appearance-none"
              >
                <option value="">Select Category</option>
                {flatCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.parent_id ? `— ${cat.name_en}` : cat.name_en}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel>Brand</FieldLabel>
              <SelectField name="brand_id" defaultValue={initialData?.brand_id || ""}>
                <option value="">Select Brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.name_en}</option>
                ))}
              </SelectField>
            </div>
          </div>
        </SectionCard>

        {/* 2. Product Images */}
        <SectionCard title="Product Images" icon={ImageIcon}>
          <ProductImageUpload
            productId={initialData?.id}
            initialImages={initialData?.images as any[]}
            onImagesChange={setSelectedImages}
          />
        </SectionCard>

        {/* 3. Pricing */}
        <SectionCard title="Pricing" icon={DollarSign}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>Base Price (EGP)</FieldLabel>
              <TextInput
                id="base_price"
                name="base_price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={initialData?.base_price || ""}
                required
                onChange={() => setLiveDiscount(discountPercent())}
              />
              {clientErrors.base_price && <p className="text-[11px] text-destructive mt-1">{clientErrors.base_price}</p>}
            </div>
            <div>
              <FieldLabel>Sale Price (EGP)</FieldLabel>
              <div className="relative">
                <TextInput
                  id="sale_price"
                  name="sale_price"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={initialData?.sale_price || ""}
                  onChange={() => setLiveDiscount(discountPercent())}
                />
                {liveDiscount > 0 && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold bg-success/10 text-success px-1.5 py-0.5 rounded">
                    -{liveDiscount}%
                  </span>
                )}
              </div>
            </div>
            <div>
              <FieldLabel>Cost Price (EGP)</FieldLabel>
              <TextInput
                name="cost_price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={initialData?.cost_price || ""}
              />
            </div>
          </div>
        </SectionCard>

        {/* 4. Inventory */}
        <SectionCard title="Inventory" icon={Package}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <FieldLabel required>Stock Quantity</FieldLabel>
              <TextInput
                name="stock_quantity"
                type="number"
                min="0"
                defaultValue={initialData?.stock_quantity ?? 0}
                required
              />
              {clientErrors.stock_quantity && <p className="text-[11px] text-destructive mt-1">{clientErrors.stock_quantity}</p>}
            </div>
            <div>
              <FieldLabel>Low Stock Alert</FieldLabel>
              <TextInput
                name="low_stock_threshold"
                type="number"
                min="0"
                defaultValue={initialData?.low_stock_threshold ?? 5}
              />
            </div>
            {mode === "edit" && initialData && (
              <div>
                <FieldLabel>Reserved</FieldLabel>
                <div className="h-9 flex items-center px-3 rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground">
                  {initialData.reserved_quantity ?? 0}
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-border">
            <div>
              <FieldLabel>Weight (kg)</FieldLabel>
              <div className="relative">
                <Weight className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <TextInput
                  name="weight"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={initialData?.weight || ""}
                  className="pl-8"
                />
              </div>
            </div>
            <div>
              <FieldLabel>Dimensions</FieldLabel>
              <div className="relative">
                <Ruler className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <TextInput
                  name="dimensions"
                  defaultValue={initialData?.dimensions || ""}
                  placeholder="L x W x H (cm)"
                  className="pl-8"
                />
              </div>
            </div>
          </div>
        </SectionCard>

        {/* 5. Description */}
        <SectionCard title="Description" icon={FileText}>
          <div className="space-y-4">
            <div>
              <FieldLabel>Description (English)</FieldLabel>
              <TextArea
                name="description_en"
                defaultValue={initialData?.description_en || ""}
                rows={5}
                placeholder="Detailed product description..."
              />
            </div>
            <div>
              <FieldLabel>Description (Arabic)</FieldLabel>
              <TextArea
                name="description_ar"
                defaultValue={initialData?.description_ar || ""}
                rows={4}
                placeholder="وصف المنتج بالتفصيل..."
                className="text-right"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Optional. Displayed on Arabic storefront.</p>
            </div>
          </div>
        </SectionCard>

        {/* 6. Technical Specifications */}
        <SectionCard title="Technical Specifications" icon={Sparkles}>
          <AttributeEditor
            categoryId={categoryId || null}
            initialValues={initialData?.attributes}
          />
        </SectionCard>

        {/* 7. SEO */}
        <SectionCard title="Search Engine Optimization" icon={Search}>
          <div className="space-y-4">
            <div>
              <FieldLabel>SEO Title</FieldLabel>
              <div className="relative">
                <TextInput
                  name="seo_title"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  placeholder="60 characters max"
                  maxLength={60}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-muted-foreground bg-muted px-1 rounded">
                  {seoTitle.length}/60
                </span>
              </div>
            </div>
            <div>
              <FieldLabel>SEO Description</FieldLabel>
              <div className="relative">
                <TextArea
                  name="seo_description"
                  value={seoDesc}
                  onChange={(e) => setSeoDesc(e.target.value)}
                  rows={3}
                  placeholder="160 characters max"
                  maxLength={160}
                />
                <span className="absolute right-3 top-3 text-[10px] font-bold text-muted-foreground bg-muted px-1 rounded">
                  {seoDesc.length}/160
                </span>
              </div>
            </div>

            {/* Google SERP Preview */}
            <div className="mt-4 p-4 rounded-lg bg-background border border-border">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Google Preview</p>
              <div className="space-y-1">
                <p className="text-sm text-primary truncate cursor-pointer hover:underline">
                  {seoTitle || nameEn || "Product Title"}
                </p>
                <p className="text-[11px] text-success truncate">
                  nest-electronics.com/products/{slug || "product-slug"}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {seoDesc || "Product description will appear here in search results..."}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* RIGHT COLUMN — Publish Sidebar */}
      <div className="w-full xl:w-[320px] shrink-0 space-y-5">

        {/* Publish Actions */}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-sm font-bold text-foreground">Publish</h2>
            {mode === "edit" && initialData && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${initialData.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                {initialData.is_active ? "Published" : "Draft"}
              </span>
            )}
          </div>
          <div className="p-5 space-y-4">
            {/* Status */}
            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-sm font-semibold">Active Status</p>
                <p className="text-[11px] text-muted-foreground">Visible to customers</p>
              </div>
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={initialData?.is_active ?? true}
                className="h-5 w-5 rounded border-2 border-primary accent-primary cursor-pointer"
              />
            </label>

            {/* Featured */}
            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-sm font-semibold">Featured</p>
                <p className="text-[11px] text-muted-foreground">Show on homepage</p>
              </div>
              <input
                type="checkbox"
                name="is_featured"
                defaultChecked={initialData?.is_featured ?? false}
                className="h-5 w-5 rounded border-2 border-primary accent-primary cursor-pointer"
              />
            </label>

            {/* Duplicate */}
            {mode === "edit" && initialData && (
              <button
                type="button"
                onClick={handleDuplicate}
                disabled={isDuplicating}
                className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                {isDuplicating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Duplicate Product
              </button>
            )}

            <div className="h-px bg-border" />

            {/* Submit Buttons */}
            <div className="space-y-2">
              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {mode === "create" ? "Publish Product" : "Save Changes"}
                  </span>
                )}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push("/products")}
                  disabled={isSubmitting}
                  className="flex-1 rounded-lg"
                >
                  Cancel
                </Button>
                {mode === "edit" && initialData && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => window.open(`/products/${initialData.slug}`, "_blank")}
                    className="rounded-lg px-3"
                    title="Preview on storefront"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Metadata */}
        {mode === "edit" && initialData && (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h2 className="text-sm font-bold text-foreground">Metadata</h2>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Product ID</span>
                <span className="font-mono text-foreground">{initialData.id.slice(0, 8)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="text-foreground">{formatDate(initialData.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span className="text-foreground">{formatDate(initialData.updated_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Available Stock</span>
                <span className="font-mono text-foreground">{initialData.available_stock ?? 0}</span>
              </div>
            </div>
          </div>
        )}

        {/* Danger Zone */}
        {mode === "edit" && initialData && (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-destructive/10">
              <h2 className="text-sm font-bold text-destructive">Danger Zone</h2>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-muted-foreground">
                Deleting a product will remove it from the catalog. This action cannot be undone.
              </p>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                className="w-full rounded-lg"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Delete Product
              </Button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
