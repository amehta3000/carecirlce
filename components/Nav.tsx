'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, Camera, FileText, Pill, Users } from 'lucide-react'

const ITEMS = [
  { href: '/', label: 'Today', Icon: CalendarCheck },
  { href: '/papers', label: 'Papers', Icon: FileText },
  { href: '/scan', label: 'Scan', Icon: Camera, scan: true },
  { href: '/meds', label: 'Meds', Icon: Pill },
  { href: '/settings', label: 'Family', Icon: Users },
]

export function Nav({ variant }: { variant: 'top' | 'tabs' }) {
  const path = usePathname()
  const active = (href: string) => (href === '/' ? path === '/' || path.startsWith('/items') : path.startsWith(href))

  if (variant === 'top') {
    return (
      <nav className="topnav" aria-label="Main">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} aria-current={active(i.href) ? 'page' : undefined}>
            {i.label}
          </Link>
        ))}
      </nav>
    )
  }
  return (
    <nav className="tabbar" aria-label="Main">
      {ITEMS.map(({ href, label, Icon, scan }) => (
        <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined} className={scan ? 'scan-tab' : undefined}>
          <span className="icon-wrap">
            <Icon size={scan ? 22 : 24} strokeWidth={2} aria-hidden />
          </span>
          {label}
        </Link>
      ))}
    </nav>
  )
}
