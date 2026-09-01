"use client";

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Battery, Cable, Cpu, Gauge, HardDrive, Radio, Wifi, Zap } from 'lucide-react';
import type { Category } from '@nest/types';

interface CategoryGridProps {
  categories: Category[];
}

const categoryIcons: Record<string, React.ReactNode> = {
  'arduino-shields': <Cpu className="w-8 h-8" />,
  'sensors-modules': <Gauge className="w-8 h-8" />,
  'motors-drivers': <Zap className="w-8 h-8" />,
  'led-displays': <Radio className="w-8 h-8" />,
  'power-supplies': <Battery className="w-8 h-8" />,
  'connectors': <Cable className="w-8 h-8" />,
  'wireless': <Wifi className="w-8 h-8" />,
  'memory-storage': <HardDrive className="w-8 h-8" />,
  'robotics-motors': <Zap className="w-8 h-8" />,
  'power-batteries': <Battery className="w-8 h-8" />,
  'tools-equipment': <Gauge className="w-8 h-8" />,
  '3d-printer-parts': <Cpu className="w-8 h-8" />,
  'raspberry-pi': <Cpu className="w-8 h-8" />,
};

export function CategoryGrid({ categories }: CategoryGridProps) {
  const roots = categories.filter((c) => !c.parent_id);

  return (
    <section className="container-nest section-gap">
      <div className="section-heading animate-impeccable-reveal">
        <div>
          <p className="section-kicker">Shop Components by Category</p>
          <h2 className="section-title">All categories</h2>
        </div>
        <Link href="/categories" className="section-link group/btn">
          View All
          <ArrowRight className="h-4 w-4 transition-transform group-hover/btn:translate-x-1" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {roots.map((cat, index) => {
          const localImage = `/images/categories/${cat.slug}.png`;
          const icon = categoryIcons[cat.slug] ?? <Cpu className="w-8 h-8" />;

          return (
            <Link
              key={cat.id}
              href={`/categories/${cat.slug}`}
              className="group flex flex-col items-center gap-3 animate-impeccable-reveal"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="cat-circle bg-white overflow-hidden border border-[var(--color-border)] transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:border-primary/40 group-hover:shadow-[0_8px_20px_rgba(0,0,0,0.06)] group-hover:-translate-y-1">
                <CategoryImage
                  src={cat.image_url || localImage}
                  alt={cat.name_en}
                  fallbackIcon={icon}
                  priority={index < 8}
                />
              </div>
              <span className="text-[13px] font-semibold text-foreground-muted text-center leading-tight transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:text-primary line-clamp-2 max-w-[100px]">
                {cat.name_en}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function CategoryImage({ src, alt, fallbackIcon, priority }: { src: string, alt: string, fallbackIcon: React.ReactNode, priority?: boolean }) {
  const [error, setError] = React.useState(false);

  if (error || !src) {
    return (
      <div className="text-foreground-muted flex items-center justify-center w-full h-full">
        {fallbackIcon}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full p-2 group-hover:scale-110 transition-transform duration-500">
      <Image
        src={src}
        alt={alt}
        fill
        className="object-contain"
        sizes="120px"
        priority={priority}
        onError={() => setError(true)}
      />
    </div>
  );
}
