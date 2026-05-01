import Link from 'next/link';
import { Cpu, Gauge, Zap, Radio, HardDrive, Wifi, Battery, Cable } from 'lucide-react';

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

const categoryIcons: Record<string, React.ReactNode> = {
  'arduino-shields': <Cpu className="w-5 h-5" />,
  'sensors-modules': <Gauge className="w-5 h-5" />,
  'motors-drivers': <Zap className="w-5 h-5" />,
  'led-displays': <Radio className="w-5 h-5" />,
  'power-supplies': <Battery className="w-5 h-5" />,
  'connectors-cables': <Cable className="w-5 h-5" />,
  'wireless-communication': <Wifi className="w-5 h-5" />,
  'memory-storage': <HardDrive className="w-5 h-5" />,
};

export function CategoryGrid({ categories }: CategoryGridProps) {
  const roots = categories.filter((c) => !c.parent_id);

  return (
    <section className="container-nest section-gap">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-heading font-semibold text-foreground">Shop by Category</h2>
        <Link href="/categories" className="text-sm text-primary hover:text-primary-hover font-medium transition-colors">
          View All
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
        {roots.map((cat) => (
          <Link
            key={cat.id}
            href={`/categories/${cat.slug}`}
            className="flex flex-col items-center gap-2.5 p-4 bg-white border border-border rounded-md hover:border-primary hover:shadow-card transition-all duration-200 text-center"
          >
            <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center text-primary transition-transform duration-200 hover:scale-105">
              {categoryIcons[cat.slug] ?? <Cpu className="w-5 h-5" />}
            </div>
            <span className="text-[12px] font-medium text-foreground leading-tight">{cat.name_en}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
