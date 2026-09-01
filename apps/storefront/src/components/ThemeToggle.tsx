'use client';

import { Sun, Moon } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useUIStore();
  const [isDark, setIsDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (theme === 'dark') setIsDark(true);
    else if (theme === 'light') setIsDark(false);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setIsDark(media.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [theme]);

  return (
    <button
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="navbar-action-btn group"
    >
      {isDark ? (
        <Sun className="w-5 h-5 text-foreground-muted group-hover:text-primary transition-colors" />
      ) : (
        <Moon className="w-5 h-5 text-foreground-muted group-hover:text-primary transition-colors" />
      )}
    </button>
  );
}
