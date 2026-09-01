# Design System Inspired by WoodMart

## 1. Visual Theme & Atmosphere

WoodMart is a premium e-commerce design system built for performance-first marketplaces. The visual identity balances sophisticated minimalism with vibrant accent colors that drive conversion and engagement. The system features a clean, spacious aesthetic with carefully curated typography that emphasizes readability and hierarchy. Deep navy backgrounds provide contrast and confidence, while warm accent tones and metallic accents add luxury and approachability. The design celebrates product imagery through generous whitespace and card-based layouts, creating an environment where items feel premium and discoverable.

**Key Characteristics**
- Performance-optimized, mobile-first responsive design
- Rich color accents against neutral backgrounds for visual clarity
- Strong typographic hierarchy using Urbanist and Albert Sans
- Card-based product showcase with consistent spacing
- Rounded, friendly button treatments balancing sophistication
- Minimal shadows and borders for clean, modern aesthetics
- Strategic use of status colors (rose, gold) for pricing and alerts

## 2. Color Palette & Roles

### Primary
- **Primary Blue** (`#007AFF`): Primary actions, navigation accents, interactive states, and brand identity elements throughout the interface
- **Primary Rose** (`#E14A5C`): Secondary actions, pricing highlights, sale indicators, and search buttons

### Accent Colors
- **Warm Taupe** (`#AD7D61`): Product category highlights, secondary product feature background
- **Soft Teal** (`#84A3B5`): Badge backgrounds, secondary category accents
- **Deep Navy** (`#0D0625`): Premium header background, high-contrast text on light surfaces
- **Slate Blue** (`#2A2F56`): Alternative dark navigation backgrounds
- **Cream** (`#EAEBB8`): Light background tints for featured product cards

### Interactive
- **Rose Button** (`#E14A5C`): Primary CTA button, search submit, add-to-cart primary actions
- **Neutral Button** (`#F3F3F3`): Secondary buttons with dark text
- **Link Text** (`#007AFF`): Hyperlinks and tertiary actions

### Neutral Scale
- **Text Primary** (`#333333`): Main body text, primary headings
- **Text Secondary** (`#777777`): Secondary text, labels, placeholders (highest usage throughout)
- **Text Tertiary** (`#767676`): Disabled states, helper text
- **Text Light** (`#A5A5A5`): Captions, fine print
- **Text Very Light** (`#BBBBBB`): Borders and dividers
- **Text Darkest** (`#242424`): High-emphasis text on light backgrounds
- **Text Muted** (`#666666`): Subtle text, category labels

### Surface & Borders
- **Background** (`#FFFFFF`): Main page background, card backgrounds
- **Border Light** (`#E9E9E9`): Subtle dividers, form field borders
- **Border Transparent** (`rgba(255, 255, 255, 0.2)`): Light borders on light backgrounds
- **Border Dark** (`rgba(0, 0, 0, 0.1)`): Form field borders on white surfaces

### Semantic / Status
- **Warning** (`#EABE12`): Star ratings, sale badges, discount indicators
- **Danger** (`#CB2027`): Error states, critical alerts

## 3. Typography Rules

### Font Family
**Primary:** Urbanist (display, headings, badges)
- Fallback stack: `Urbanist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

**Secondary:** Albert Sans (body, buttons, inputs, navigation)
- Fallback stack: `Albert Sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|-----------------|-------|
| Display / Hero | Urbanist | 36px | 700 | 43.2px | 0px | Page section headings, promotional titles |
| Heading 3 | Urbanist | 15px | 600 | 21px | 0px | Card titles, subsection headers |
| Heading 4 | Urbanist | 14px | 600 | 14px | 0px | Small section headers, badge text |
| Body Text | Albert Sans | 13px | 400 | 13px | 0px | Product descriptions, general content |
| Button Text | Albert Sans | 13px | 600 | 15.6px | 0px | All button labels |
| Link Text | Albert Sans | 13px | 600 | 15.6px | 0px | Inline and standalone links |
| Label | Albert Sans | 15px | 400 | 24px | 0px | Form labels, input labels |
| Input Placeholder | Albert Sans | 14px | 400 | 22.4px | 0px | Form field placeholder text |
| Caption / Small | Urbanist | 12px | 400 | 16.8px | 0px | Image captions, footnotes, timestamps |

### Principles
- **Hierarchy through weight, not size:** Urbanist provides visual distinction at consistent sizes through bold weights
- **Line height generosity:** All line heights exceed 1.2× font size for readability in e-commerce product-heavy layouts
- **Semantic consistency:** Headings use Urbanist for elegance; body and functional text use Albert Sans for clarity
- **Accessibility first:** Minimum 13px body text ensures readability on all devices
- **Button emphasis:** 600 weight on button text creates tactile, clickable appearance

## 4. Component Stylings

### Buttons

#### Primary Button
- **Background:** `#E14A5C`
- **Text Color:** `#FFFFFF`
- **Font:** Albert Sans, 13px, 600 weight
- **Padding:** `5px 20px`
- **Height:** `42px`
- **Border Radius:** `35px`
- **Border:** None
- **Line Height:** `15.6px`
- **Hover State:** Darken background to `#C73A4B`
- **Active State:** Darken further to `#B02D3D`
- **Disabled State:** Background `#E9E9E9`, text `#BBBBBB`

#### Secondary Button
- **Background:** `#F3F3F3`
- **Text Color:** `#3E3E3E`
- **Font:** Albert Sans, 13px, 600 weight
- **Padding:** `5px 20px`
- **Height:** `42px`
- **Border Radius:** `0px`
- **Border:** `1px solid #E9E9E9`
- **Line Height:** `15.6px`
- **Hover State:** Background `#E6E6E6`, text `#333333`

#### Ghost / Text Button
- **Background:** `transparent`
- **Text Color:** `#777777`
- **Font:** Albert Sans, 15px, 400 weight
- **Padding:** `0px`
- **Height:** `24px`
- **Border Radius:** `0px`
- **Border:** None
- **Line Height:** `24px`
- **Hover State:** Text color `#333333`

#### Search Submit Button
- **Background:** `#E14A5C`
- **Text Color:** `#FFFFFF`
- **Font:** Albert Sans, 0px (icon-only)
- **Padding:** `0px`
- **Height:** `34px`
- **Width:** `34px`
- **Border Radius:** `35px`
- **Border:** None
- **Icon:** 16px white search icon
- **Hover State:** Background `#C73A4B`

### Cards & Containers

#### Product Card
- **Background:** `#FFFFFF`
- **Text Color:** `#777777`
- **Padding:** `0px 0px 15px 0px`
- **Border Radius:** `0px`
- **Border:** `1px solid #E9E9E9` (bottom edge)
- **Box Shadow:** None
- **Typography:** Albert Sans, 15px, 400 weight
- **Line Height:** `24px`
- **Image Container:** Full width, aspect ratio maintained
- **Product Title:** Urbanist, 14px, 600 weight
- **Price:** Albert Sans, 13px, 600 weight, `#E14A5C`
- **Rating Stars:** `#EABE12`, 14px icons
- **Hover State:** Light gray background tint `#F9F9F9`

#### Feature / Promotion Card
- **Background:** Gradient or solid accent (e.g., `#84A3B5` or `#EAEBB8`)
- **Text Color:** `#FFFFFF` or `#333333` (varies by card)
- **Padding:** `40px`
- **Border Radius:** `12px`
- **Border:** None
- **Box Shadow:** None
- **Image Integration:** Background image with overlay
- **Heading:** Urbanist, 36px, 700 weight
- **Subheading:** Albert Sans, 15px, 400 weight
- **CTA Button:** Primary button style

#### Badge / Label
- **Background:** `#EABE12` (warning) or `#E14A5C` (hot/sale)
- **Text Color:** `#FFFFFF`
- **Font:** Urbanist, 12px, 400 weight
- **Padding:** `4px 8px`
- **Border Radius:** `50%` or `4px`
- **Height:** `24px`
- **Line Height:** `16.8px`
- **Text Transform:** Uppercase

### Inputs & Forms

#### Search Input (Main)
- **Background:** `#FFFFFF`
- **Text Color:** `#777777`
- **Font:** Albert Sans, 14px, 400 weight
- **Padding:** `0px 72px 0px 15px` (right padding for submit button)
- **Height:** `42px`
- **Width:** `100%` (responsive)
- **Border Radius:** `35px`
- **Border:** `1px solid rgba(255, 255, 255, 0.2)`
- **Line Height:** `22.4px`
- **Placeholder Color:** `#777777`
- **Focus State:** Border `1px solid #007AFF`, box-shadow `0 0 0 3px rgba(0, 122, 255, 0.1)`
- **Submit Button:** Positioned right at `0px` as part of input group

#### Search Input (Header Mobile)
- **Background:** `#FFFFFF`
- **Text Color:** `#777777`
- **Font:** Albert Sans, 14px, 400 weight
- **Padding:** `0px 68px 0px 15px`
- **Height:** `38px`
- **Width:** `100%`
- **Border Radius:** `35px`
- **Border:** `1px solid rgba(255, 255, 255, 0.2)`
- **Line Height:** `22.4px`

#### Text Input (General)
- **Background:** `#FFFFFF`
- **Text Color:** `#777777`
- **Font:** Albert Sans, 14px, 400 weight
- **Padding:** `0px 15px`
- **Height:** `auto` (min 40px)
- **Border Radius:** `35px`
- **Border:** `1px solid rgba(0, 0, 0, 0.1)`
- **Line Height:** `22.4px`
- **Focus State:** Border `1px solid #007AFF`

#### Form Label
- **Font:** Albert Sans, 15px, 400 weight
- **Color:** `#333333`
- **Line Height:** `24px`
- **Margin Bottom:** `8px`

### Navigation

#### Primary Navigation Menu
- **Background:** `#E14A5C` (horizontal bar)
- **Text Color:** `#FFFFFF`
- **Font:** Albert Sans, 15px, 400 weight
- **Padding:** `0px 10px` (per menu item)
- **Height:** `42px`
- **Border Radius:** `0px`
- **Border:** None
- **Line Height:** `24px`
- **Icon Size:** `18px` before text
- **Hover State:** Background `#C73A4B`, text `#FFFFFF`
- **Active State:** Underline `2px solid #FFFFFF`

#### Dropdown Menu
- **Background:** `#FFFFFF`
- **Text Color:** `#777777`
- **Font:** Albert Sans, 13px, 400 weight
- **Padding:** `12px 16px` (per item)
- **Border Radius:** `0px`
- **Border:** `1px solid #E9E9E9`
- **Box Shadow:** `rgba(0, 0, 0, 0.15) 0px 0px 3px 0px`
- **Hover State:** Background `#F9F9F9`

#### Breadcrumb Navigation
- **Font:** Albert Sans, 12px, 400 weight
- **Text Color:** `#777777`
- **Separator:** `/` in `#BBBBBB`
- **Current Page:** `#333333`, 600 weight
- **Line Height:** `16.8px`

### Links
- **Text Color:** `#007AFF`
- **Font:** Albert Sans, 13px, 600 weight
- **Line Height:** `15.6px`
- **Text Decoration:** None (default)
- **Hover State:** `#0056CC` with underline
- **Active State:** `#004399`
- **Visited State:** `#6B4FA0`

## 5. Layout Principles

### Spacing System
**Base Unit:** 4px

**Scale:**
- **Micro:** 4px (gap between inline elements)
- **Small:** 8px (gap between related components)
- **Base:** 12px (padding inside components)
- **Medium:** 16px (standard padding, gap between sections)
- **Large:** 20px (gap between major sections)
- **XL:** 32px (space between card groups)
- **2XL:** 40px (section padding)
- **3XL:** 80px (top/bottom margin for page sections)

**Usage Context:**
- **4px:** Button icon spacing, compact badge padding
- **8px:** Form field gaps, small container padding
- **12px:** Component internal padding, tight layout spacing
- **16px:** Card padding, standard container spacing
- **20px:** Section divider spacing
- **32px:** Product grid gaps, section spacing
- **40px:** Container internal padding, feature card padding
- **80px:** Page section top/bottom margins

### Grid & Container
- **Max Width:** 1395px (observed from extraction)
- **Column Strategy:** 4-column grid for product listings (responsive: 1 col mobile, 2 col tablet, 4 col desktop)
- **Gutter:** 32px between columns
- **Container Padding:** 40px horizontal on desktop, 16px on mobile
- **Section Patterns:**
  - Hero banner: full-width, 80px top/bottom margin
  - Product grid: 4-column with 32px gaps, centered within max-width container
  - Feature sections: alternating full-width backgrounds with centered content
  - Category navigation: full-width sticky or fixed positioning

### Whitespace Philosophy
WoodMart embraces generous whitespace to elevate product imagery and reduce cognitive load. Spacing is hierarchical—tighter spacing groups related items, while larger gaps separate distinct sections. Product cards breathe with minimum 32px gaps, and featured content receives prominent breathing room with 40px+ padding. This approach makes the interface feel premium and accessible simultaneously.

### Border Radius Scale
- **0px:** Standard containers, product cards, navigation, forms (sharp, modern aesthetic)
- **4px:** Badge backgrounds, small component accents
- **12px:** Feature/promotion cards (medium roundness for emphasis)
- **20px:** Icon buttons, compact rounded treatments
- **35px:** All buttons and primary search inputs (generous roundness for approachability)
- **50%:** Badge indicators, circular badge backgrounds, avatar placeholders

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat | No shadow | Product cards, backgrounds, text elements |
| Raised | `rgba(0, 0, 0, 0.15) 0px 0px 3px 0px` | Dropdowns, floating menus, search suggestions |
| Floating | `rgba(0, 0, 0, 0.2) 0px 4px 12px 0px` | Modals, overlays, elevated panels (inferred) |

**Shadow Philosophy:**
WoodMart employs minimal shadows to maintain clean aesthetics and ensure product imagery dominates visual hierarchy. Shadows are used sparingly and softly—only for dropdowns and floating UI elements that truly need spatial separation. The design avoids heavy shadows, preferring subtle shifts in background color and border styling to establish depth. This approach keeps the interface modern and focuses user attention on content rather than visual effects.

## 7. Do's and Don'ts

### Do
- **Use rose (`#E14A5C`) for all primary CTAs** — Add to cart, search submit, checkout buttons
- **Maintain 4-column product grids** on desktop with consistent 32px gaps
- **Apply Urbanist for all headings** to maintain visual hierarchy and brand consistency
- **Include icon badges** (e.g., "HOT," "-20%") on product cards for attention
- **Use generous padding (40px)** in feature/promotional cards to elevate content
- **Keep buttons at 42px height minimum** for touch accessibility
- **Apply 35px border-radius to inputs and buttons** for friendly, rounded appearance
- **Star ratings in warning color (`#EABE12`)** for visual consistency
- **Maintain high contrast** between text and background (minimum WCAG AA)
- **Right-align pricing and cart totals** for scannability

### Don't
- **Avoid adding shadows** unless implementing dropdowns or floating elements
- **Don't use secondary button style** for primary actions — reserve for secondary workflows
- **Avoid narrow column counts** on desktop (never less than 3 columns for product grids)
- **Don't increase base font size** above 15px for body text without redesigning hierarchy
- **Avoid heavy color overlays** — keep transparency under 30% for readability
- **Don't use rounded corners** on product cards (maintain 0px border-radius for modern feel)
- **Avoid mixing font families** within a single component
- **Don't add borders to buttons** unless they are secondary/ghost variants
- **Avoid truncating product titles** — use multi-line text with consistent line-height
- **Don't reduce padding below 12px** in interactive components

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | 320px–767px | 1-column product grid, 16px horizontal padding, 38px search input, stacked navigation, full-width cards |
| Tablet | 768px–1024px | 2-column product grid, 24px horizontal padding, 42px search input, sidebar navigation, medium cards |
| Desktop | 1025px–1395px | 4-column product grid, 40px horizontal padding, full search, horizontal navigation, max-width container |
| Large Desktop | 1396px+ | Same as desktop, centered within 1395px max-width |

### Touch Targets
- **Minimum tap area:** 44px × 44px (all buttons, interactive elements)
- **Minimum touch spacing:** 12px between adjacent interactive elements
- **Search button:** 34px × 34px on mobile, 42px × 42px on desktop
- **Navigation menu items:** 42px height, minimum 40px width
- **Link padding:** 8px vertical, 0px horizontal (for text links within paragraphs)

### Collapsing Strategy
- **Navigation:** Hamburger menu on mobile (320px), horizontal menu on tablet+ (768px+)
- **Product Grid:** 1 column → 2 columns at 768px → 4 columns at 1025px
- **Search Input:** 38px height (mobile) → 42px height (tablet+)
- **Container Padding:** 16px (mobile) → 24px (tablet) → 40px (desktop)
- **Feature Cards:** Stack vertically on mobile, side-by-side on tablet+
- **Hero Banner:** Image background scales, text remains legible
- **Card Padding:** 12px (mobile) → 16px (tablet) → 20px (desktop)
- **Section Spacing:** 40px (mobile) → 60px (tablet) → 80px (desktop)

## 9. Agent Prompt Guide

### Quick Color Reference
- **Primary CTA:** Rose (`#E14A5C`) — buttons, search submit, add-to-cart
- **Secondary Button:** Neutral (`#F3F3F3`) — secondary actions
- **Link Text:** Primary Blue (`#007AFF`) — hyperlinks
- **Body Text:** Secondary Gray (`#777777`) — main content
- **Heading Text:** Primary Dark (`#333333`) — titles
- **Background:** White (`#FFFFFF`) — surfaces, cards
- **Status Success:** Gold/Warning (`#EABE12`) — star ratings, badges
- **Status Danger:** Red (`#CB2027`) — error alerts
- **Borders:** Light Gray (`#E9E9E9`) or `rgba(0, 0, 0, 0.1)` — dividers

### Iteration Guide

1. **Always use 35px border-radius for buttons and main search inputs** — this defines the friendly, approachable brand aesthetic
2. **Apply 4-column product grids on desktop with 32px gaps** — verified from extraction; maintain consistency
3. **Use Urbanist (700 weight) for display/headings and Albert Sans (400/600 weight) for body/buttons** — strict font separation ensures hierarchy
4. **Set minimum button height to 42px** for touch accessibility and visual weight
5. **Keep product cards flat with 0px border-radius** — no shadows, minimal styling elevates imagery
6. **Use rose (`#E14A5C`) for all high-action CTAs and secondary blue (`#007AFF`) for links** — color consistency drives conversion
7. **Apply 40px padding to feature/promotional cards** — creates premium feel and breathing room
8. **Reserve secondary button style (`#F3F3F3`) for non-primary actions only** — prevents confusion with main CTAs
9. **Maintain 1-column mobile, 2-column tablet, 4-column desktop grid layout** — ensures responsive consistency
10. **Star ratings must always use warning gold (`#EABE12`)** — verified visual pattern throughout design system