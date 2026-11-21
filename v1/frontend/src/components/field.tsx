import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'

type FieldProps = {
  label: string
  htmlFor?: string
  hint?: string
  /** Poruka greške; kad postoji, polje dobija `aria-invalid` i `aria-describedby`. */
  error?: string
  children: ReactNode
}

type DescribedChild = ReactElement<{
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}>

/**
 * FE-03: veza label ↔ polje ↔ poruka je obavezna (WCAG 3.3.1/3.3.2). Poruka se čita odmah
 * (`role="alert"`) i polje je označeno kao neispravno, umjesto da greška postoji samo u toastu.
 */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  const hintId = hint && htmlFor ? `${htmlFor}-hint` : undefined
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  const child =
    isValidElement<Record<string, unknown>>(children) && (describedBy || error)
      ? cloneElement(children as DescribedChild, {
          'aria-describedby': describedBy,
          'aria-invalid': error ? true : undefined,
        })
      : children

  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {child}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
