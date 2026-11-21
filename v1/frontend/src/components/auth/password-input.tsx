import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'

type Props = Omit<React.ComponentProps<typeof Input>, 'type'>

/**
 * FE-07 — polje lozinke sa prekidačem vidljivosti.
 *
 * Zašto: duge lozinke se na telefonu (i uz ekransku tastaturu) gotovo ne mogu unijeti bez greške,
 * a „pogriješio si“ poruka ne pomaže ako korisnik ne vidi šta je otkucao. Prekidač je **dugme sa
 * stanjem** (`aria-pressed`) i tekstualnim imenom (ikona nije jedini nosilac značenja).
 * `Field` prosljeđuje `aria-describedby`/`aria-invalid`, pa se oni spuštaju na samo polje.
 */
export function PasswordInput(props: Props) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className="pr-11" />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-pressed={visible}
        aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
