import type { Config } from 'tailwindcss';

export const nestPreset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#ffffff',
        surface: {
          DEFAULT: '#f8fafc',
          low: '#f1f5f9',
        },
        foreground: {
          DEFAULT: '#0f172a',
          muted: '#64748b',
          subtle: '#94a3b8',
          disabled: '#cbd5e1',
        },
        primary: {
          DEFAULT: '#1d4ed8',
          hover: '#1e40af',
          light: '#eff6ff',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: '#f1f5f9',
          hover: '#e2e8f0',
          foreground: '#334155',
        },
        border: {
          DEFAULT: '#e2e8f0',
          strong: '#cbd5e1',
          focus: '#1d4ed8',
        },
        success: {
          DEFAULT: '#15803d',
          light: '#f0fdf4',
          foreground: '#ffffff',
        },
        warning: {
          DEFAULT: '#b45309',
          light: '#fffbeb',
          foreground: '#ffffff',
        },
        danger: {
          DEFAULT: '#b91c1c',
          light: '#fef2f2',
          foreground: '#ffffff',
        },
        muted: {
          DEFAULT: '#f8fafc',
          foreground: '#64748b',
        },
        accent: {
          DEFAULT: '#1d4ed8',
          foreground: '#ffffff',
        },
        card: {
          DEFAULT: '#ffffff',
          foreground: '#0f172a',
        },
        popover: {
          DEFAULT: '#ffffff',
          foreground: '#0f172a',
        },
        input: '#e2e8f0',
        ring: '#1d4ed8',
        destructive: {
          DEFAULT: '#b91c1c',
          foreground: '#ffffff',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Space Grotesk', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        hero: 'clamp(32px, 4vw, 48px)',
        'section-title': ['22px', { lineHeight: '1.3' }],
        'product-name': ['13px', { lineHeight: '1.4' }],
        body: ['14px', { lineHeight: '1.5' }],
        caption: ['12px', { lineHeight: '1.4' }],
        label: ['11px', { lineHeight: '1.4', letterSpacing: '0.05em' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        full: '9999px',
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.10)',
        dropdown: '0 8px 30px rgba(0,0,0,0.12)',
        modal: '0 20px 60px rgba(0,0,0,0.18)',
      },
      maxWidth: {
        container: '1280px',
      },
    },
  },
};
