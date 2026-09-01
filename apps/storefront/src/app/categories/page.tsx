import { getServices } from "@/lib/services";
import Link from "next/link";
import Image from "next/image";
import { Cpu, ArrowRight, Layers } from "lucide-react";
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
    <div className="bg-muted min-h-screen pb-16">
      {/* Page Header Area */}
      <div className="bg-card border-b border-border mb-10 relative overflow-hidden">
        {/* Subtle background decoration */}
        <div className="absolute right-0 top-0 w-1/2 h-full opacity-5 pointer-events-none hero-circuit"></div>
        <div className="absolute left-10 top-1/2 -translate-y-1/2 w-64 h-64 bg-primary/10 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="container-marketplace py-10 lg:py-14 relative z-10">
          <nav className="flex items-center gap-2 text-xs font-medium text-foreground-muted mb-6" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-primary transition-colors">Home</Link>
            <span className="opacity-50">/</span>
            <span className="text-foreground">All Categories</span>
          </nav>

          <div className="flex items-center gap-4 mb-3">
            <div className="w-12 h-12 rounded-xl bg-primary-light text-primary flex items-center justify-center">
              <Layers className="w-6 h-6" />
            </div>
            <h1 className="text-3xl md:text-4xl font-heading font-bold text-foreground">
              Shop by Category
            </h1>
          </div>
          <p className="text-foreground-muted max-w-2xl text-sm md:text-base">
            Explore our comprehensive catalog of electronics components, development boards, and modules for your next big project.
          </p>
        </div>
      </div>

      <div className="container-marketplace">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/categories/${cat.slug}`}
              className="card card-hover group flex flex-col overflow-hidden"
            >
              {/* Image Area */}
              <div className="relative aspect-[4/3] bg-surface-low overflow-hidden flex items-center justify-center">
                {cat.image_url ? (
                  <Image 
                    src={cat.image_url} 
                    alt={cat.name_en} 
                    fill 
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-primary-light flex items-center justify-center text-primary transition-transform duration-500 group-hover:scale-110">
                    <Cpu className="w-10 h-10" />
                  </div>
                )}
                
                {/* Floating Badge (optional depending on content) */}
                <div className="absolute top-3 right-3 bg-card/90 backdrop-blur-sm text-foreground text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm">
                  {cat.children?.length ?? 0} Subcategories
                </div>
              </div>

              {/* Content Area */}
              <div className="p-5 flex flex-col flex-1">
                <h3 className="text-lg font-heading font-bold text-foreground mb-3 group-hover:text-primary transition-colors">
                  {cat.name_en}
                </h3>
                
                {cat.children && cat.children.length > 0 ? (
                  <div className="space-y-2 mb-4 flex-1">
                    {cat.children.slice(0, 4).map((sub) => (
                      <div key={sub.id} className="text-sm text-foreground-muted hover:text-primary transition-colors flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-border-strong group-hover:bg-primary-light transition-colors"></span>
                        {sub.name_en}
                      </div>
                    ))}
                    {cat.children.length > 4 && (
                      <div className="text-xs font-semibold text-primary mt-2">
                        + {cat.children.length - 4} more categories
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex-1"></div>
                )}

                <div className="pt-4 mt-auto border-t border-border flex items-center justify-between text-sm font-semibold text-foreground-subtle group-hover:text-primary transition-colors">
                  <span>Browse Products</span>
                  <ArrowRight className="w-4 h-4 transform transition-transform group-hover:translate-x-1" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
