import { Truck, ShieldCheck, Banknote, Headphones } from 'lucide-react';

export function TrustBar() {
  const items = [
    { icon: Truck, title: 'Fast Delivery', sub: 'Cairo & Alexandria' },
    { icon: ShieldCheck, title: '100% Genuine', sub: 'Authentic components' },
    { icon: Banknote, title: 'Cash on Delivery', sub: 'Pay when you receive' },
    { icon: Headphones, title: 'Technical Support', sub: 'Engineer-led support' },
  ];

  return (
    <section className="bg-surface border-y border-border py-4">
      <div className="container-nest">
        <div className="flex flex-wrap justify-center divide-x divide-border">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-6 py-2">
              <item.icon className="text-primary text-xl" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <p className="text-xs text-foreground-muted">{item.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
