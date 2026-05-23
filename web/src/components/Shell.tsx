import type { ReactNode } from 'react'
import type { User } from '@freeappstore/sdk'

interface ShellProps {
  children: ReactNode
  user?: User | null
  onSignIn?: () => void
  onSignOut?: () => void
}

export function Shell({ children, user, onSignIn, onSignOut }: ShellProps) {
  return (
    <div className="relative min-h-[100dvh]">
      <div className="mx-auto max-w-[1540px] px-2 pt-1 sm:px-4 lg:px-8 lg:py-8">
        <div className="min-h-[100dvh] pb-14 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-7 lg:pb-0">
          {/* Desktop sidebar */}
          <aside className="hidden lg:flex lg:min-h-[calc(100dvh-4rem)] lg:flex-col lg:gap-5 lg:rounded-[2rem] lg:border lg:border-[var(--line)] lg:bg-[var(--glass-strong)] lg:p-6 lg:shadow-[var(--shadow-soft)] lg:backdrop-blur-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--glass)] px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--accent-deep)]">
              Meet
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {user ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {user.avatarUrl && (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="h-6 w-6 rounded-full"
                      />
                    )}
                    <span className="text-sm font-medium text-[var(--ink)]">
                      {user.login}
                    </span>
                  </div>
                  <button
                    onClick={onSignOut}
                    className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <button
                  onClick={onSignIn}
                  className="rounded-lg bg-[var(--ink)] px-3 py-2 text-xs font-semibold text-[var(--paper)] hover:opacity-90"
                >
                  Sign in with GitHub
                </button>
              )}
            </div>

            <div className="mt-auto text-[0.65rem] text-[var(--muted)]">
              Part of{' '}
              <a
                href="https://freeappstore.online"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--ink)]"
              >
                FreeAppStore
              </a>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* Mobile header */}
            <div className="flex items-center justify-between py-3 lg:hidden">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--accent-deep)]">
                Meet
              </span>
              {user ? (
                <div className="flex items-center gap-2">
                  {user.avatarUrl && (
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="h-5 w-5 rounded-full"
                    />
                  )}
                  <button
                    onClick={onSignOut}
                    className="text-xs text-[var(--muted)]"
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <button
                  onClick={onSignIn}
                  className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-xs font-semibold text-[var(--paper)]"
                >
                  Sign in
                </button>
              )}
            </div>
            {children}
          </main>
        </div>
      </div>

      {/* Mobile dock */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--dock)]/92 px-2 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-1 backdrop-blur-2xl lg:hidden">
        <div className="mx-auto grid max-w-xs grid-cols-1 py-2">
          <a
            href="https://freeappstore.online"
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-[0.65rem] font-bold uppercase tracking-[0.14em] text-[var(--muted)]"
          >
            Part of FreeAppStore
          </a>
        </div>
      </nav>
    </div>
  )
}
