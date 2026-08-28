import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from './ui/input'
import { useSession } from '../SessionContext'
import { cn } from '@/lib/utils'

/**
 * A password field with a show/hide toggle.
 *
 * Every screen that asks for a password uses this one — sign-up especially, where the
 * customer is choosing a string they have never typed before and cannot check it against
 * anything. A masked-only field there is how a typo becomes a password nobody knows.
 *
 * The toggle is a plain `<button type="button">`: inside a `<form>` an unqualified button
 * submits, so revealing the password would post the form.
 */
export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const { t } = useSession()
  const [shown, setShown] = useState(false)

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        // Room for the toggle: without it a long password runs under the icon.
        className={cn('pr-11', className)}
      />
      <button
        type="button"
        onClick={() => setShown(v => !v)}
        aria-pressed={shown}
        aria-label={shown ? t('Hide password', '隐藏密码') : t('Show password', '显示密码')}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-primary cursor-pointer"
      >
        {shown ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
      </button>
    </div>
  )
}
