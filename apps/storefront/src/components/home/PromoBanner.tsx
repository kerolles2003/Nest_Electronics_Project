import Link from 'next/link';

export function PromoBanner() {
  return (
    <section className="py-10 bg-gray-50">
      <div className="container-marketplace">
        <div className="flex flex-col lg:flex-row gap-6">
          
          {/* Blue Discount Banner */}
          <div className="lg:w-[70%] bg-[#3156cf] rounded-[16px] overflow-hidden flex flex-col md:flex-row shadow-sm min-h-[340px] relative">
            <div className="md:w-[40%] p-8 md:p-10 flex flex-col justify-center relative z-10">
              <div className="absolute top-8 right-0 md:-right-4 w-[60px] h-[60px] bg-red-500 rounded-full flex flex-col items-center justify-center text-white z-20 shadow-md">
                <span className="text-[11px] font-bold leading-none">Save up to</span>
                <span className="text-[16px] font-extrabold leading-none mt-0.5">-45%</span>
              </div>
              <h2 className="text-3xl md:text-[34px] font-black text-white leading-tight mb-6">Get discount <br /> on PS5 games</h2>
              <button className="bg-white text-gray-900 px-8 py-2.5 rounded-full font-bold text-[13px] w-fit hover:bg-gray-100 transition-colors shadow-sm">Buy Now</button>
            </div>

            <div className="md:w-[60%] grid grid-cols-3 gap-4 p-6 md:p-8 relative">
              <div className="absolute inset-0 bg-[#3156cf]/80 mix-blend-multiply" />
              {[
                { name: 'S.T.A.L.K.E.R. 2: Heart of', category: 'Games', price: '$240.00', emoji: '🎮' },
                { name: 'Horizon Zero Dawn', category: 'Games', price: '$39.00', emoji: '🏹', badge: 'HOT' },
                { name: 'Mafia: Definitive Edition', category: 'Games', price: '$60.00', emoji: '🎲' },
              ].map((game, i) => (
                <div key={i} className="bg-white rounded-xl p-3 flex flex-col items-center text-center group cursor-pointer hover:shadow-lg transition-all relative z-10">
                  {game.badge && (
                    <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-[3px] text-[10px] font-bold text-white bg-red-500 shadow-sm leading-none z-20">
                      {game.badge}
                    </span>
                  )}
                  <div className="w-[85%] aspect-[3/4] mb-3 mt-2 overflow-hidden flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 rounded-sm group-hover:scale-105 transition-transform duration-500">
                    <span className="text-4xl">{game.emoji}</span>
                  </div>
                  <h4 className="text-[12px] font-bold text-gray-800 leading-tight mb-0.5 px-1">{game.name}</h4>
                  <span className="text-[10px] text-gray-400 mb-1.5">{game.category}</span>
                  <p className="text-red-500 font-bold text-[13px]">{game.price}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Top 100 Appliances Sidebar */}
          <div className="lg:w-[30%] bg-white rounded-[16px] shadow-sm border border-gray-100 p-6 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[16px] font-bold text-gray-900 border-b-2 border-transparent">Top 100 appliances</h3>
              <Link href="#" className="text-[12px] font-bold text-gray-800 border-b border-gray-800 hover:text-red-500 hover:border-red-500 transition-colors pb-0.5">Shop More</Link>
            </div>

            <div className="flex flex-col gap-4 flex-1 justify-between">
              {[
                { name: 'LG Airtcool AC12EQ', price: '$1,300.00', color: 'bg-blue-50' },
                { name: 'Braun SI 9281 BK', price: '$110.00', color: 'bg-gray-50' },
                { name: 'Karcher VC 3 Premium', price: '$128.00', old: '$160.00', color: 'bg-yellow-50' },
                { name: 'Tefal PERFECTMIX', price: '$120.00', color: 'bg-red-50' },
                { name: 'Bamix Luxuryline M200', price: '$605.00', color: 'bg-purple-50' },
                { name: 'Bosch MS6CM617E', price: '$100.00', color: 'bg-green-50' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-[45px] h-[45px] ${item.color} border border-gray-100 rounded-[6px] flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="1.5"/><circle cx="12" cy="12" r="3" strokeWidth="1.5"/></svg>
                  </div>
                  <div className="flex flex-col flex-1">
                     <h4 className="text-[12px] font-bold text-gray-800 leading-tight mb-0.5 group-hover:text-red-500 transition-colors">{item.name}</h4>
                     <div className="flex items-center gap-1.5">
                       {item.old && <span className="text-[11px] text-gray-400 line-through">{item.old}</span>}
                       <p className="text-red-500 font-bold text-[13px] leading-none">{item.price}</p>
                     </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
