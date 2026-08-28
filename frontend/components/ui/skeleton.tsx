import { cn } from '@/lib/utils'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular'
}

function Skeleton({ className, variant = 'text', ...props }: SkeletonProps) {
  const baseStyles = 'animate-pulse rounded bg-muted'
  
  const variants = {
    text: 'h-4 w-full',
    circular: 'h-10 w-10 rounded-full',
    rectangular: 'h-16 w-full rounded-lg',
  }

  return (
    <div
      className={cn(baseStyles, variants[variant], className)}
      {...props}
    />
  )
}

export { Skeleton }