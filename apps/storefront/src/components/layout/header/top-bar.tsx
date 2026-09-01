import Link from 'next/link';
import { Clock, MapPin } from 'lucide-react';
import { TOP_NAV_LINKS } from '@nest/config/constants';

export function TopBar() {
  return (
    <div className="bg-topbar text-topbar-foreground py-1.5 text-[12px] hidden md:block">
      <div className="container-marketplace flex justify-between items-center">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2 text-topbar-foreground/90">
            <Clock className="w-3.5 h-3.5" />
            <span>Dispatch from Cairo before 3 PM</span>
          </div>
          <div className="flex items-center gap-2 text-topbar-foreground/90">
            <MapPin className="w-3.5 h-3.5" />
            <span>Maadi stock counter</span>
          </div>
        </div>

        <div className="flex items-center divide-x divide-white/15 text-topbar-foreground/80">
          {TOP_NAV_LINKS.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              className={`hover:text-white transition-colors ${i === 0 ? 'pr-3' : i === TOP_NAV_LINKS.length - 1 ? 'pl-3' : 'px-3'}`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
