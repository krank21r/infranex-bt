import { LoginForm } from '@/components/auth/login-form'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in - Infranex BT',
  description: 'Sign in to access your Infranex BT dashboard',
}

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </main>
  )
}