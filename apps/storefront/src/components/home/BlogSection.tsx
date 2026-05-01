import Link from 'next/link';

export function BlogSection() {
  const posts = [
    {
      id: 1,
      title: 'Our of world beautiful activities',
      date: 'April 20, 2024',
      emoji: '📱',
      category: 'ELECTRONICS',
      gradient: 'from-blue-100 to-purple-100'
    },
    {
      id: 2,
      title: 'The best way to enjoy your music',
      date: 'April 18, 2024',
      emoji: '🎧',
      category: 'AUDIO',
      gradient: 'from-pink-100 to-red-100'
    },
    {
      id: 3,
      title: 'Smart home gadgets you need',
      date: 'April 15, 2024',
      emoji: '🏠',
      category: 'SMART HOME',
      gradient: 'from-green-100 to-teal-100'
    }
  ];

  return (
    <section className="py-16 bg-white border-t border-gray-100">
      <div className="container-marketplace">
        <div className="text-center mb-12">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em] mb-4 block">OUR BLOG</span>
          <h2 className="text-3xl font-black text-secondary uppercase tracking-tighter">Last news</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {posts.map((post) => (
            <div key={post.id} className="group cursor-pointer">
              <div className={`relative aspect-[16/10] rounded-2xl overflow-hidden mb-6 bg-gradient-to-br ${post.gradient} flex items-center justify-center group-hover:scale-105 transition-transform duration-300`}>
                <span className="text-5xl">{post.emoji}</span>
                <div className="absolute top-4 left-4 bg-white px-3 py-1 rounded-full text-[9px] font-black text-secondary shadow-lg">
                  {post.category}
                </div>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase">{post.date}</span>
                <div className="w-1 h-1 rounded-full bg-gray-200" />
                <span className="text-[10px] font-bold text-primary uppercase">0 COMMENTS</span>
              </div>
              <h3 className="text-xl font-bold text-secondary group-hover:text-primary transition-colors leading-tight">
                {post.title}
              </h3>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
