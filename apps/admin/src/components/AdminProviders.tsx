'use client'

import { ToastProvider } from '@nest/ui'

export function AdminProviders({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}
