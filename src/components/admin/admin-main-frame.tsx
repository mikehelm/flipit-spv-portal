'use client'

import { usePathname } from 'next/navigation'

export function AdminMainFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isEmailReview = pathname === '/admin/email-review'

  return (
    <main
      id="main"
      className={
        isEmailReview
          ? 'mt-8 w-full px-3 sm:px-4'
          : 'mx-auto mt-8 w-full max-w-6xl px-4 sm:px-6'
      }
    >
      {children}
    </main>
  )
}
