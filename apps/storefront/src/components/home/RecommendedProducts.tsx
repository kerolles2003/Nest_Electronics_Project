interface RecommendedProps {
  products: { id: string; name: string }[];
}

export function RecommendedProducts({ products }: RecommendedProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _products = products;
  const dummyProducts = [
    { name: 'Xiaomi Mi RedmiBook 15', category: 'Business Laptop', price: '$540.00', oldPrice: '$600.00', emoji: '💻', rating: 0, badge: '-10%' },
    { name: 'ASUS ROG Strix G17', category: 'Gaming Laptop', price: '$1,849.00', oldPrice: '$2,300.00', emoji: '🎮', rating: 4, badge: '-20%' },
    { name: 'HP Victus 16-e0174nw', category: 'Gaming Laptop', price: '$918.00', oldPrice: '$1,020.00', emoji: '💻', rating: 5, badge: '-10%', hot: true },
    { name: 'HP ZBook Firefly 14 G8', category: 'Ultrabook', price: '$1,619.00', oldPrice: '$1,900.00', emoji: '💼', rating: 0, badge: '-15%' },
    { name: 'Apple iPad Mini 6 Wi-Fi', category: 'Apple iPad', price: '$580.00 - $850.00', oldPrice: null, emoji: '📟', rating: 0, badge: '-15%', hot: true },
  ];

  return (
    <section className="py-10 bg-gray-50">
      <div className="container-marketplace">
        
        {/* Large Product Callouts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
           <div className="bg-white rounded-[16px] p-10 flex flex-col items-center text-center shadow-sm cursor-pointer group">
             <div className="h-[220px] mb-6 flex items-center justify-center p-4 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl w-full group-hover:scale-105 transition-transform">
                 <span className="text-6xl">⌚</span>
             </div>
             <h3 className="text-2xl font-extrabold text-gray-900 mb-3">Next level adventure</h3>
             <p className="text-gray-500 text-[13px] leading-relaxed max-w-sm mb-6">A magical new way to use your watch without touching the screen. The brightest Apple display ever.</p>
             <button className="bg-red-500 text-white px-6 py-2 rounded-full font-bold text-[12px] hover:bg-black transition-colors shadow-sm">Shop Now</button>
           </div>
           <div className="bg-[#111] rounded-[16px] p-10 flex flex-col items-center text-center shadow-sm cursor-pointer group">
             <div className="h-[220px] mb-6 flex items-center justify-center p-4 relative z-10 w-full bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl group-hover:scale-105 transition-transform">
                 <span className="text-6xl">🪑</span>
             </div>
             <h3 className="text-2xl font-extrabold text-white mb-3 tracking-wide z-20 relative">Hearth loft series</h3>
             <p className="text-gray-400 text-[13px] leading-relaxed max-w-sm mb-6 z-20 relative">The expressive proportions of the seating's surface, combined with the soft, curved arms create the ideal haven for relaxation.</p>
             <button className="bg-red-500 text-white px-6 py-2 rounded-full font-bold text-[12px] hover:bg-white hover:text-black transition-colors shadow-sm relative z-20">Shop Now</button>
           </div>
           <div className="bg-white rounded-[16px] p-10 flex flex-col items-center text-center shadow-sm cursor-pointer group">
             <div className="h-[220px] mb-6 flex items-center justify-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl w-full group-hover:scale-105 transition-transform">
                 <span className="text-6xl">💨</span>
             </div>
             <h3 className="text-2xl font-extrabold text-gray-900 mb-3">Hair dryer blue blush</h3>
             <p className="text-gray-500 text-[13px] leading-relaxed max-w-sm mb-6">Finished in Blue Blush, cushioned with soft fabric and with a removable lid that is also a non-slip mat for your hair dryer.</p>
             <button className="bg-red-500 text-white px-6 py-2 rounded-full font-bold text-[12px] hover:bg-black transition-colors shadow-sm">Shop Now</button>
           </div>
        </div>

        {/* More Recommended Products Row */}
        <h2 className="text-[20px] font-bold text-gray-900 mb-6">More recommended products</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {dummyProducts.map((product, i) => (
             <div key={i} className="bg-white rounded-xl p-3 flex flex-col hover:shadow-lg transition-all cursor-pointer border border-transparent hover:border-gray-200 group relative">
                {/* Badges */}
                <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
                  {product.badge && (
                    <span className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold text-white bg-green-500 shadow-sm leading-none flex items-center justify-center">
                      {product.badge}
                    </span>
                  )}
                  {product.hot && (
                    <span className="px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold text-white bg-red-500 shadow-sm leading-none flex items-center justify-center">
                      HOT
                    </span>
                  )}
                </div>

                <div className="w-full aspect-[4/3] bg-gray-50 mb-4 p-2 overflow-hidden flex items-center justify-center rounded-lg group-hover:scale-105 transition-transform">
                  <span className="text-4xl">{product.emoji}</span>
                </div>

                <div className="flex flex-col text-center mt-auto">
                  <span className="text-[10px] text-gray-400 font-medium mb-1">{product.category}</span>
                  <h3 className="text-[12.5px] font-bold text-gray-800 leading-tight mb-1.5 h-[30px] line-clamp-2 px-1 hover:text-red-500 transition-colors">{product.name}</h3>
                  
                  {product.rating > 0 ? (
                    <div className="flex items-center justify-center gap-0.5 mb-2 h-3">
                       {[...Array(5)].map((_, idx) => (
                         <svg key={idx} className={`w-[11px] h-[11px] ${idx < product.rating ? 'text-[#f5a623]' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
                           <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                         </svg>
                       ))}
                    </div>
                  ) : <div className="h-3 mb-2" />}

                  <div className="flex items-center justify-center gap-1.5">
                    {product.oldPrice && <span className="text-[12px] text-gray-400 line-through">{product.oldPrice}</span>}
                    <span className="text-[14px] font-bold text-red-500">{product.price}</span>
                  </div>
                </div>
             </div>
          ))}
        </div>

      </div>
    </section>
  );
}
