'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { SearchBar } from '@/components/layout/header/search-bar';
import type { Category } from '@nest/types';

interface HeroBannerProps {
  categories: Category[];
}

const slides = [
  {
    id: 1,
    kicker: 'Ship same day from Cairo',
    title: "Build what's next.",
    subtitle: 'Arduino, ESP32, sensors, and robotics modules stocked for serious student and maker projects.',
    cta: 'Browse all components',
    ctaHref: '/products',
    image: '/images/banners/1.webp',
  },
  {
    id: 2,
    kicker: 'Recently restocked',
    title: 'ESP32-S3 dev boards.',
    subtitle: 'Dual-core, Wi-Fi plus BLE, PSRAM-ready boards for IoT prototypes and graduation builds.',
    cta: 'Shop ESP32',
    ctaHref: '/products?search=esp32',
    image: '/images/banners/2.webp',
  },
  {
    id: 3,
    kicker: 'Student project ready',
    title: 'Start your senior project.',
    subtitle: 'Curated parts for robotics, sensors, displays, motor drivers, and power systems.',
    cta: 'Explore project parts',
    ctaHref: '/products',
    image: '/images/banners/3.webp',
  },
];

export function HeroBanner({ categories }: HeroBannerProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const preferStaticHero = window.matchMedia('(max-width: 767px)').matches;
    if (isPaused || preferStaticHero) return;

    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % slides.length);
    }, 8000);

    return () => clearInterval(timer);
  }, [isPaused]);

  const slide = slides[currentSlide] ?? slides[0]!;
  const quickCategories = categories.filter((c) => !c.parent_id).slice(0, 4);

  return (
    <section className="bg-background pt-6 pb-5 md:pt-8 md:pb-7">
      <div className="container-marketplace">
        <div
          className="relative min-h-[430px] overflow-hidden rounded-sm border border-[var(--color-border)] bg-black"
          onPointerEnter={() => setIsPaused(true)}
          onPointerLeave={() => setIsPaused(false)}
          onFocus={() => setIsPaused(true)}
        >
          {slides.map((s, idx) => (
            <div
              key={s.id}
              className={`absolute inset-0 transition-opacity duration-[1200ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${
                idx === currentSlide ? 'z-0 opacity-100' : '-z-10 opacity-0'
              }`}
            >
              <Image
                src={s.image}
                alt={s.title}
                fill
                className={`object-cover ${idx === currentSlide ? 'animate-impeccable-image' : ''}`}
                priority={idx === 0}
              />
              <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/45 to-black/10" />
            </div>
          ))}

          <div className="relative z-10 flex min-h-[430px] flex-col justify-center p-6 md:p-10 lg:p-14">
            <div className="max-w-[760px]" key={`content-${currentSlide}`}>
              <p className="mb-4 text-[12px] font-bold uppercase tracking-widest text-primary animate-impeccable-reveal">
                {slide.kicker}
              </p>
              <h1 className="mb-4 max-w-[560px] font-heading text-[2.25rem] font-black leading-[1.1] text-white md:text-[3.25rem] animate-impeccable-reveal delay-100">
                {slide.title}
              </h1>
              <p className="mb-7 max-w-[520px] text-[15px] leading-relaxed text-slate-200 animate-impeccable-reveal delay-200">
                {slide.subtitle}
              </p>

              <div className="mb-5 max-w-3xl rounded-sm bg-white p-1.5 animate-impeccable-reveal delay-300">
                <SearchBar categories={categories} />
              </div>

              <div className="mb-7 flex flex-wrap items-center gap-2 text-[13px] text-white/80 animate-impeccable-reveal delay-400">
                <span className="font-semibold text-white">Popular:</span>
                {quickCategories.map((cat) => (
                  <Link
                    key={cat.id}
                    href={`/categories/${cat.slug}`}
                    className="border-b border-white/25 pb-0.5 transition-colors hover:border-primary hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                  >
                    {cat.name_en}
                  </Link>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-4 animate-impeccable-reveal delay-500">
                <Link
                  href={slide.ctaHref}
                  className="inline-flex min-h-[42px] items-center rounded-[35px] bg-primary px-6 py-2.5 text-[13px] font-bold text-primary-foreground transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary-hover hover:scale-[1.02] hover:shadow-[0_8px_20px_rgba(225,74,92,0.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary active:scale-[0.98]"
                >
                  {slide.cta}
                </Link>
                <Link
                  href="/categories"
                  className="inline-flex min-h-[42px] items-center border-b border-white/30 text-[13px] font-semibold text-white transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-white hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                >
                  Shop by category
                </Link>
              </div>
            </div>
          </div>

          <div className="absolute bottom-5 left-6 z-20 flex gap-2 md:left-auto md:right-8">
            {slides.map((_, index) => (
              <button
                key={index}
                onClick={() => {
                  setCurrentSlide(index);
                  setIsPaused(true);
                }}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === currentSlide ? 'w-10 bg-primary' : 'w-2 bg-white/30 hover:bg-white/60'
                }`}
                aria-current={index === currentSlide ? 'true' : undefined}
                aria-label={`Go to slide ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
