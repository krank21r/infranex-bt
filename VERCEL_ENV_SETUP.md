# Vercel Environment Variables Setup

## Frontend Project (`infranex-bt`)

| Variable | Prefix | Scope | Description |
|----------|--------|-------|-------------|
| `NEXT_PUBLIC_API_URL` | `NEXT_PUBLIC_` | **Browser** | Backend API URL (e.g. `https://infranex-bt-backend.vercel.app`) |
| `NEXT_PUBLIC_SUPABASE_URL` | `NEXT_PUBLIC_` | **Browser** | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_` | **Browser** | Supabase **anon** key (designed for client-side use) |
| `SUPABASE_SERVICE_ROLE_KEY` | *(none)* | **Server Only** | Supabase **service_role** key — NEVER expose to browser |
| `NEXT_PUBLIC_APP_NAME` | `NEXT_PUBLIC_` | **Browser** | App display name |

## Backend Project (`infranex-bt-backend`)

| Variable | Prefix | Scope | Description |
|----------|--------|-------|-------------|
| `SUPABASE_URL` | *(none)* | Server | Supabase project URL |
| `SUPABASE_ANON_KEY` | *(none)* | Server | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | *(none)* | Server | Supabase service role key |
| `DATABASE_URL` | *(none)* | Server | Postgres connection string |
| `DATABASE_POOLER_URL` | *(none)* | Server | PgBouncer pooler URL |
| `CORS_ORIGINS` | *(none)* | Server | `https://infranex-bt.vercel.app,https://infranex-bt-backend.vercel.app` |
| `SECRET_KEY` | *(none)* | Server | JWT signing secret |
| `CRON_SECRET` | *(none)* | Server | Vercel cron auth secret |
| `APP_ENV` | *(none)* | Server | `production` |
| `DEPLOYMENT_MODE` | *(none)* | Server | `production` |

---

## Key Security Principle

```
NEXT_PUBLIC_*  →  Bundled into client JS  →  Visible in browser
(no prefix)    →  Server-only              →  Never leaves Vercel
```

| Key Type | Safe for Browser? | Vercel Prefix |
|----------|-------------------|---------------|
| Supabase **anon** key | ✅ Yes (designed for it) | `NEXT_PUBLIC_` |
| Supabase **service_role** key | ❌ No (admin access) | *(none)* |
| Database URLs | ❌ No | *(none)* |
| JWT secrets | ❌ No | *(none)* |
| API keys | ❌ No | *(none)* |

---

## Usage in Code

```typescript
// lib/supabase/client.ts — Client component (browser)
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,      // Public
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!  // Public (anon key)
  )
}

// lib/supabase/server.ts — Server component / API route
import { createServerClient } from '@supabase/ssr'

export async function createClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,        // Public
    process.env.SUPABASE_SERVICE_ROLE_KEY!,       // PRIVATE - server only!
    { cookies: ... }
  )
}
```

---

## Deployment Checklist

- [ ] Frontend: `NEXT_PUBLIC_API_URL` = `https://infranex-bt-backend.vercel.app`
- [ ] Frontend: `NEXT_PUBLIC_SUPABASE_URL` = your Supabase URL
- [ ] Frontend: `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key
- [ ] Frontend: `SUPABASE_SERVICE_ROLE_KEY` = your service role key (no prefix!)
- [ ] Backend: All server variables set (no `NEXT_PUBLIC_` prefix)
- [ ] Backend: `CORS_ORIGINS` includes frontend URL
- [ ] Both: Redeploy after setting variables