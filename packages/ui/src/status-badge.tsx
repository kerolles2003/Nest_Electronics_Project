import { cn } from "./utils"

const statusStyles: Record<string, string> = {
  // Success states
  active: "bg-success/10 text-success border-success/20",
  approved: "bg-success/10 text-success border-success/20",
  delivered: "bg-success/10 text-success border-success/20",
  paid: "bg-success/10 text-success border-success/20",
  in_stock: "bg-success/10 text-success border-success/20",
  // Warning / pending states
  pending: "bg-warning/10 text-warning border-warning/20",
  processing: "bg-warning/10 text-warning border-warning/20",
  unfulfilled: "bg-warning/10 text-warning border-warning/20",
  pending_payment: "bg-warning/10 text-warning border-warning/20",
  low_stock: "bg-warning/10 text-warning border-warning/20",
  authorized: "bg-warning/10 text-warning border-warning/20",
  // Destructive / failure states
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  out_of_stock: "bg-destructive/10 text-destructive border-destructive/20",
  returned: "bg-destructive/10 text-destructive border-destructive/20",
  // Primary / in-progress states
  shipped: "bg-primary/10 text-primary border-primary/20",
  // Muted / neutral states
  inactive: "bg-muted text-muted-foreground border-border",
  draft: "bg-muted text-muted-foreground border-border",
  archived: "bg-muted text-muted-foreground border-border",
  refunded: "bg-muted text-muted-foreground border-border",
  partially_refunded: "bg-muted text-muted-foreground border-border",
  deleted: "bg-muted text-muted-foreground border-border",
}

export interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase().replace(/\s+/g, "_")
  const colorClasses =
    statusStyles[normalized] ??
    "bg-muted text-muted-foreground border-border"

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border",
        colorClasses,
        className
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  )
}
