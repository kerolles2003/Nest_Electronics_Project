import { getServices } from "@/lib/services";
import Link from "next/link";
import { Cpu } from "lucide-react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "All Categories | Nest Electronics",
  description: "Browse all electronics categories at Nest Electronics. Arduino, sensors, motors, displays, Raspberry Pi and more.",
};

export const revalidate = 3600;

export default async function CategoriesPage() {
  const { productService } = await getServices();
  const categories = await productService.getCategoryTree();

  return (
    <div className="container-nest py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-foreground-muted mb-4" aria-label="Breadcrumb">
        <Link href="/" className="hover:text-primary transition-colors">Home</Link>
        <span>/</span>
        <span className="text-foreground font-medium">All Categories</span>
      </nav>

      <h1 className="text-2xl font-heading font-semibold text-foreground mb-6">All Categories</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {categories.map((cat) => (
          <Link
            key={cat.id}
            href={`/categories/${cat.slug}`}
            className="bg-white border border-border rounded-lg p-5 hover:border-primary hover:shadow-card transition-all group"
          >
            <div className="w-12 h-12 bg-primary-light rounded-lg flex items-center justify-center text-primary mb-3 group-hover:bg-primary group-hover:text-white transition-colors">
              <Cpu className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{cat.name_en}</h3>
            <p className="text-xs text-foreground-muted">{cat.children?.length ?? 0} subcategories</p>
            {cat.children && cat.children.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border space-y-1">
                {cat.children.slice(0, 3).map((sub) => (
                  <span key={sub.id} className="block text-xs text-foreground-muted hover:text-primary transition-colors">
                    {sub.name_en}
                  </span>
                ))}
                {cat.children.length > 3 && (
                  <span className="text-xs text-primary">+{cat.children.length - 3} more</span>
                )}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
