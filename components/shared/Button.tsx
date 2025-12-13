import { clsx } from 'clsx'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }

export default function Button({ className, variant = 'primary', ...rest }: Props) {
  const base = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors'
  const v = variant === 'primary' ? 'bg-brand-500 text-white hover:bg-brand-600' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
  return <button className={clsx(base, v, className)} {...rest} />
}

