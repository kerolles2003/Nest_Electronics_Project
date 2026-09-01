import Link from 'next/link';
import { Menu } from 'lucide-react';
import { Category } from '@nest/types';

export function BrowseCategories({ categories }: { categories: Category[] }) {
  const rootCategories = categories.filter(c => !c.parent_id);

  return (
    <div className="relative group h-full">
      <button className="flex items-center gap-3 bg-primary-hover text-primary-foreground h-[44px] px-4 font-semibold text-[13px] w-[238px]">
        <Menu className="w-4 h-4" />
        Browse Categories
      </button>

      <div className="absolute top-[44px] left-0 w-[238px] bg-card border border-[var(--color-border)] border-t-0 shadow-card opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-150 z-50">
        <ul className="py-1.5">
          {rootCategories.slice(0, 12).map((cat) => (
            <li key={cat.id}>
              <Link href={`/categories/${cat.slug}`} className="block px-4 py-2 text-[13px] text-foreground hover:bg-surface hover:text-primary transition-colors font-medium">
                {cat.name_en}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
