import { Truck, ShieldCheck, Banknote, Headphones } from 'lucide-react';

export function TrustBar() {
  const items = [
    { icon: Truck, title: 'Cairo stock', sub: 'Dispatch before 3 PM' },
    { icon: ShieldCheck, title: 'Verified parts', sub: 'Boards and modules checked' },
    { icon: Banknote, title: 'Cash on delivery', sub: 'Pay after arrival' },
    { icon: Headphones, title: 'Engineer support', sub: 'Help choosing compatible parts' },
  ];

  return (
    <section className="border-y border-[var(--color-border)] bg-surface-low">
      <div className="container-nest">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.title}
              className="trust-icon-box group"
            >
              <div className="trust-icon-circle">
                <item.icon className="h-5 w-5 text-primary" strokeWidth={1.7} />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-tight text-foreground">{item.title}</p>
                <p className="mt-1 text-[12px] font-normal leading-tight text-foreground-muted">{item.sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
