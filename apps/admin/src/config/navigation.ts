import {
  LayoutDashboard,
  Package,
  Tag,
  Award,
  Warehouse,
  ShoppingBag,
  Ticket,
  Users,
  Star,
  Shield,
  Settings,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export interface NavSection {
  label: string
  items: NavItem[]
}

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

export const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Catalog",
    items: [
      { href: "/products", label: "Products", icon: Package },
      { href: "/categories", label: "Categories", icon: Tag },
      { href: "/brands", label: "Brands", icon: Award },
      { href: "/inventory", label: "Inventory", icon: Warehouse },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/orders", label: "Orders", icon: ShoppingBag },
      { href: "/coupons", label: "Coupons", icon: Ticket },
    ],
  },
  {
    label: "Users",
    items: [
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/reviews", label: "Reviews", icon: Star },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/audit-log", label: "Audit Log", icon: Shield },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
]
