import { requireAdmin, getCachedCategories } from '@/lib/services';
import { CategoriesManager } from '@/components/categories/CategoriesManager';
import type { Category } from '@nest/types';

function flattenCategories(cats: Category[]): Category[] {
  const result: Category[] = [];
  const walk = (list: Category[]) => {
    for (const c of list) {
      result.push(c);
      if (c.children && c.children.length > 0) walk(c.children);
    }
  };
  walk(cats);
  return result;
}

export default async function CategoriesPage() {
  await requireAdmin();
  const categories = await getCachedCategories();

  const flat = flattenCategories(categories);
  const activeIds = new Set(flat.filter(c => !c.deleted_at).map(c => c.id));

  const stats = {
    total: flat.length,
    active: flat.filter(c => !c.deleted_at).length,
    inactive: flat.filter(c => c.deleted_at).length,
    topLevel: flat.filter(c => !c.parent_id && !c.deleted_at).length,
    withChildren: flat.filter(c => {
      if (c.deleted_at) return false;
      return flat.some(child => child.parent_id === c.id && !child.deleted_at);
    }).length,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Categories</h1>
        <p className="text-sm text-muted-foreground mt-1">Organize your product catalog hierarchy.</p>
      </div>
      <CategoriesManager initialCategories={flat} stats={stats} activeIds={activeIds} />
    </div>
  );
}
