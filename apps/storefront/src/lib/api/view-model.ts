import type { Brand as LegacyBrand, Category as LegacyCategory } from '@nest/types';
import { imageUrl } from '../images';
import type { Brand, Category, CategoryTreeNode, ProductListItem } from './types';

/**
 * API responses in the shapes the existing components already accept.
 *
 * ## Why an adapter instead of changing the components
 *
 * The T1 migration's acceptance criterion is **structural parity**: same
 * layout, same components, every state still handled, no visual regression.
 * The safest way to meet that is for the components not to change at all —
 * then a page that renders differently can only be a data problem, and there is
 * exactly one place to look.
 *
 * The alternative — rewriting `ProductCard`, `FilterSidebar`, `CategoryGrid`,
 * `BrowseCategories`, `MobileMenu` and `SearchBar` to take API types — would
 * mix a data-source migration with a component rewrite in the same commit, and
 * any visual difference afterwards would have two possible causes instead of
 * one.
 *
 * ## This file is temporary, and that is deliberate
 *
 * It exists because two data layers exist. When Phase 9 deletes the Supabase
 * layer, `@nest/types` goes with it, the components take API types directly,
 * and this file is deleted whole. Naming that now is what keeps it from
 * quietly becoming a permanent translation layer nobody dares remove.
 *
 * Nothing here contains business logic. Every function is a rename and a
 * reshape; anything that needed a decision would belong on the server.
 */

/**
 * A category node in the legacy flat shape.
 *
 * The header components filter roots themselves (`categories.filter(c =>
 * !c.parent_id)`), so they need the FLAT list even though the API can return a
 * tree — see `flattenCategoryTree`.
 *
 * `image_url` is `null` rather than a derived Cloudinary URL, and that is
 * correct rather than lazy: `CategoryGrid` already falls back to a local file
 * at `/images/categories/<slug>.png`, so a null here uses the design's own
 * artwork. Category cover images are a Phase 7 concern, and nothing has ever
 * uploaded one.
 *
 * `deleted_at` is always null because the API only ever returns live
 * categories — a deleted one is absent, not flagged.
 */
export function toLegacyCategory(category: Category): LegacyCategory {
  return {
    id: category.id,
    name_en: category.name,
    // The API resolves localisation server-side from `Accept-Language` and
    // returns plain strings, so there is no second language to carry here.
    name_ar: null,
    slug: category.slug,
    parent_id: category.parentId,
    image_url: null,
    sort_order: category.sortOrder,
    is_active: true,
    deleted_at: null,
  };
}

/**
 * The nested tree, flattened depth-first, parents before children.
 *
 * Depth-first rather than level-by-level so a child always follows its parent,
 * which is the order the mobile menu renders in and the order a person expects
 * when reading a list of categories.
 *
 * Recursive with no depth limit on purpose: the API's tree is three levels deep
 * in one branch today and a fixed two-level walk would silently drop the third.
 */
export function flattenCategoryTree(nodes: readonly CategoryTreeNode[]): LegacyCategory[] {
  return nodes.flatMap((node) => [toLegacyCategory(node), ...flattenCategoryTree(node.children)]);
}

export function toLegacyBrand(brand: Brand): LegacyBrand {
  return {
    id: brand.id,
    name_en: brand.name,
    name_ar: null,
    slug: brand.slug,
    logo_url: imageUrl(brand.logo, 'thumbnail'),
    is_active: true,
    deleted_at: null,
  };
}

/**
 * The card view-model every product grid on the site takes.
 *
 * Matches the object the legacy pages built by hand from a Supabase row, field
 * for field, so `ProductCard` cannot tell the difference.
 */
export interface ProductCardModel {
  id: string;
  slug: string;
  sku: string;
  name: string;
  brandName: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  basePrice: number;
  salePrice: number | null;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  availableStock: number;
  isFeatured: boolean;
}

export function toProductCard(product: ProductListItem): ProductCardModel {
  return {
    id: product.id,
    slug: product.slug,
    sku: product.sku,
    name: product.name,
    brandName: product.brand?.name ?? null,
    categoryName: product.category.name,
    imageUrl: imageUrl(product.primaryImage, 'thumbnail'),

    /*
     * MAJOR units, because that is what the card's own `formatPrice` expects.
     *
     * The API is authoritative in minor units and this is the only place the
     * conversion happens. It is a display conversion at the very edge of the
     * system, not arithmetic: nothing is added, compared or totalled here, and
     * every amount a customer is asked to PAY still comes from the server as a
     * pre-formatted string (MONEY-MODEL.md — "never do money arithmetic on the
     * client").
     */
    basePrice: product.pricing.basePrice.amount / 100,
    salePrice: product.pricing.salePrice === null ? null : product.pricing.salePrice.amount / 100,

    // The API sends the mean in hundredths (430 = 4.30); the card wants a
    // decimal for its star row.
    rating: product.rating.average / 100,
    reviewCount: product.rating.count,

    inStock: product.availability !== 'OUT_OF_STOCK',

    /*
     * NOT the real stock figure, and deliberately so.
     *
     * The list endpoint returns `availability` — IN_STOCK / LOW_STOCK /
     * OUT_OF_STOCK — and no count, because an exact figure on a listing page is
     * operational detail that turns into a promise the next order can break.
     * The card uses this only to decide whether "Add to cart" is enabled, so a
     * binary is all it needs, and the server clamps the quantity on every cart
     * write regardless of what a client believed.
     */
    availableStock: product.availability === 'OUT_OF_STOCK' ? 0 : 1,

    isFeatured: product.isFeatured,
  };
}
