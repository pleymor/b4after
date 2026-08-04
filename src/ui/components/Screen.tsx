import type { ReactNode } from 'react'

export function Screen({
  title,
  back,
  action,
  children,
}: {
  title: string
  back?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
        {back}
        <h1 className="flex-1 truncate text-lg font-semibold">{title}</h1>
        {action}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
