import * as api from "@/lib/api/endpoints";
import { flattenCategoryTree } from "@/lib/api/view-model";
import type { Category } from "@nest/types";
import { TopBar } from "./layout/header/top-bar";
import { MainHeader } from "./layout/header/main-header";
import { CategoryNav } from "./layout/header/category-nav";

/**
 * The site header, on the API.
 *
 * ## What changed, and what did not
 *
 * The data source. `TopBar`, `MainHeader` and `CategoryNav` are untouched, and
 * they still receive the same flat `Category[]` — `flattenCategoryTree` reshapes
 * the API's nested tree into it. That is the T1 rule: move the reads, leave the
 * design alone, so any visual difference has exactly one possible cause.
 *
 * ## This removes a Supabase query from EVERY page render
 *
 * The navbar lives in the root layout, so its `getServices()` call ran on every
 * request to every page — including `/shop`, which is otherwise entirely
 * API-backed. That one import is why the "no Supabase on the API-backed pages"
 * claim was not yet true anywhere.
 *
 * ## Why the tree is fetched here rather than passed down
 *
 * It is `revalidate: 300` on a public, unauthenticated endpoint, so the second
 * render of any page inside five minutes costs nothing. Threading it through
 * every page's props to save one cached call would couple every page to the
 * chrome's data needs.
 */
export async function Navbar() {
  const categories = await categoryTree();

  return (
    <header className="flex flex-col w-full bg-background">
      <TopBar />
      <MainHeader categories={categories} />
      <CategoryNav categories={categories} />
    </header>
  );
}

/**
 * The category tree, or an empty list if the API cannot be reached.
 *
 * ## Why this one swallows its error when the pages do not
 *
 * Because of WHERE it is. This component is in the root layout, so an
 * unhandled rejection here does not fail a category menu — it fails every page
 * on the site, including `/shop`, checkout and the order pages, none of which
 * need a category tree to do their job. Trading a menu for the whole storefront
 * is the wrong trade at any level of API availability.
 *
 * The failure is not hidden: it is logged with its cause, and the header renders
 * WITHOUT the browse menu rather than rendering a menu that lies. A page's own
 * data still throws normally — `/categories` with no categories is a broken
 * page and should say so.
 */
async function categoryTree(): Promise<Category[]> {
  try {
    const response = await api.getCategoryTree();

    return flattenCategoryTree(response.data);
  } catch (error) {
    console.error(
      'Navbar: the category tree could not be loaded; rendering the header without it.',
      error,
    );

    return [];
  }
}
