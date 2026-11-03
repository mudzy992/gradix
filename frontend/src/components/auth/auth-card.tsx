import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type Props = {
  title: string
  description?: ReactNode
  children: ReactNode
  /** Samostalni ekrani (prijava, zaboravljena lozinka) centriraju karticu u cijelom prozoru. */
  standalone?: boolean
  className?: string
}

/**
 * FE-07 — jedan okvir za sve auth ekrane.
 *
 * Zašto komponenta: `login` je poslije FE-03 imao `h1`, a `forgot`/`reset`/`change-password` su
 * naslov renderovali kao `div` (`CardTitle`) — ekran bez naslova nije čitljiv čitaču ekrana
 * (WCAG 1.3.1/2.4.6). Jedan okvir garantuje da svaki auth ekran ima **jedno `h1`** i isti raspored.
 */
export function AuthCard({ title, description, children, standalone = true, className }: Props) {
  const card = (
    <Card className={cn('w-full max-w-md', className)}>
      <CardHeader>
        <h1 className="text-lg font-semibold leading-none">{title}</h1>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
  if (!standalone) {
    return card
  }
  return <div className="flex min-h-svh items-center justify-center p-4">{card}</div>
}
