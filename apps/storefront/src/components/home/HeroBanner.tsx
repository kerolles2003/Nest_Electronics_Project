import Link from 'next/link';
import { Cpu, Gauge, Radio, Zap } from 'lucide-react';

interface HeroBannerProps {
  categories: Array<{ id: string; name_en: string; slug: string }>;
}

const categoryIcons: Record<string, React.ReactNode> = {
  'arduino-shields': <Cpu className="w-6 h-6" />,
  'sensors-modules': <Gauge className="w-6 h-6" />,
  'motors-drivers': <Zap className="w-6 h-6" />,
  'led-displays': <Radio className="w-6 h-6" />,
};

export function HeroBanner({ categories }: HeroBannerProps) {
  const heroCategories = categories
    .filter((c) => ['arduino-shields', 'sensors-modules', 'motors-drivers', 'led-displays'].includes(c.slug))
    .slice(0, 4);

  return (
    <section className="bg-gradient-to-br from-primary-light via-white to-surface">
      <div className="container-nest py-12 md:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
          {/* Left: Text Content */}
          <div>
            <span className="text-xs font-semibold text-primary uppercase tracking-widest mb-3 block">
              🇪🇬 Egypt&apos;s #1 Electronics Store
            </span>
            <h1 className="text-hero font-heading font-bold text-foreground leading-tight">
              Everything You Need to Build Your Next Project
            </h1>
            <p className="text-base text-foreground-muted max-w-md mt-3">
              Arduino, ESP32, sensors, motors, displays and 500+ more components. Delivered across Egypt.
            </p>
            <div className="flex gap-3 mt-6">
              <Link href="/products" className="btn-primary px-6 py-2.5 text-sm inline-flex items-center justify-center">
                Shop Now
              </Link>
              <Link href="/categories" className="btn-secondary px-6 py-2.5 text-sm inline-flex items-center justify-center">
                Browse Categories
              </Link>
            </div>
          </div>

          {/* Right: Category Icon Cards */}
          <div className="grid grid-cols-2 gap-3">
            {heroCategories.map((cat) => (
              <Link
                key={cat.id}
                href={`/categories/${cat.slug}`}
                className="rounded-xl bg-white border border-border shadow-card p-4 flex flex-col items-center gap-2 text-center hover:border-primary hover:shadow-card-hover transition-all"
              >
                <div className="text-primary bg-primary-light rounded-lg p-3">
                  {categoryIcons[cat.slug] ?? <Cpu className="w-6 h-6" />}
                </div>
                <span className="text-sm font-medium text-foreground">{cat.name_en}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
