import Link from 'next/link';
import { MAIN_NAV_LINKS } from '@nest/config/constants';
import { BrowseCategories } from './browse-categories';
import { Category } from '@nest/types';

interface CategoryNavProps {
  categories: Category[];
}

export function CategoryNav({ categories }: CategoryNavProps) {
  return (
    <div className="bg-category-bar text-category-foreground hidden lg:block sticky top-0 z-40">
      <div className="container-marketplace flex items-center gap-5">
        <div className="shrink-0 h-[44px]">
          <BrowseCategories categories={categories} />
        </div>

        <nav className="flex items-center gap-0.5 h-[44px]">
          {MAIN_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 h-full flex items-center text-[12px] font-bold text-category-foreground uppercase tracking-[0.08em] hover:bg-black/10 transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center h-[44px] text-[12px] font-semibold text-category-foreground/95">
          <span>Cairo stock, engineer-checked parts</span>
        </div>
      </div>
    </div>
  );
}
