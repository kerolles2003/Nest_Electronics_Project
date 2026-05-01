import { Truck, ShieldCheck, Banknote, Headphones } from 'lucide-react';

export function TrustBar() {
  const items = [
    { icon: Truck, title: 'Fast Delivery', sub: 'Cairo & Alexandria' },
    { icon: ShieldCheck, title: '100% Genuine', sub: 'Authentic components' },
    { icon: Banknote, title: 'Cash on Delivery', sub: 'Pay when you receive' },
    { icon: Headphones, title: 'Technical Support', sub: 'Engineer-led support' },
  ];

  return (
    <section className="bg-surface border-y border-border py-5">
      <div className="container-nest">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <item.icon className="text-primary w-4 h-4" strokeWidth={1.5} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">{item.title}</p>
                <p className="text-xs text-foreground-muted leading-tight mt-0.5">{item.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
