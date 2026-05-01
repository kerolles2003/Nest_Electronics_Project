import Link from 'next/link';
import { Cpu } from 'lucide-react';

interface Category {
  id: string;
  name_en: string;
  slug: string;
  parent_id: string | null;
  children?: Category[];
}

interface CategoryGridProps {
  categories: Category[];
}

export function CategoryGrid({ categories }: CategoryGridProps) {
  const roots = categories.filter((c) => !c.parent_id);

  return (
    <section className="container-nest section-gap">
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-xl font-heading font-semibold text-foreground">Shop by Category</h2>
        <Link href="/categories" className="text-sm text-primary hover:text-primary-hover font-medium transition-colors">
          View All
        </Link>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
        {roots.map((cat) => (
          <Link
            key={cat.id}
            href={`/categories/${cat.slug}`}
            className="flex flex-col items-center gap-2 p-3 bg-white border border-border rounded-md hover:border-primary hover:shadow-card transition-all text-center"
          >
            <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center text-primary">
              <Cpu className="w-5 h-5" />
            </div>
            <span className="text-[12px] font-medium text-foreground leading-tight">{cat.name_en}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
