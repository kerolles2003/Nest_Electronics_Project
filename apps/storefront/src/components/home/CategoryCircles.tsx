import Link from 'next/link';

interface CategoryItem {
  id: string;
  name_en: string;
  slug: string;
  icon?: string;
}

export function CategoryCircles({ categories }: { categories: CategoryItem[] }) {
  const defaultCats = [
    { name: 'Appliances', emoji: '🔌' },
    { name: 'Chairs', emoji: '🪑' },
    { name: 'Face', emoji: '💆' },
    { name: 'Gaming', emoji: '🎮' },
    { name: 'Jumpers', emoji: '🧥' },
    { name: 'Laptops', emoji: '💻' },
    { name: 'Laundry', emoji: '🧺' },
    { name: 'PCs', emoji: '🖥️' },
    { name: 'Phones', emoji: '📱' },
    { name: 'Styling', emoji: '💇' },
  ];

  return (
    <section className="py-10 bg-white">
      <div className="container-marketplace">
        <h2 className="text-[20px] font-bold text-gray-900 mb-8 border-b-2 border-transparent">Shop by categories</h2>
        <div className="flex items-center justify-between overflow-x-auto pb-4 gap-6 scrollbar-thin">
          {defaultCats.map((cat, i) => (
            <Link key={i} href="#" className="flex flex-col items-center gap-3 group min-w-[70px] md:min-w-[90px] flex-shrink-0">
              <div className="relative w-[85px] h-[85px] md:w-[100px] md:h-[100px] rounded-full bg-white border border-gray-100 flex items-center justify-center shadow-sm hover:shadow-md transition-shadow group-hover:-translate-y-1 transition-transform p-3 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100">
                <span className="text-3xl md:text-4xl group-hover:scale-105 transition-transform">{cat.emoji}</span>
              </div>
              <span className="text-[13px] font-bold text-gray-700">{cat.name}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
