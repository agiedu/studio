# Supabase and Cloudflare deployment

1. Create a Supabase project, then run `supabase/migrations/20260905_auth_and_roles.sql` in its SQL Editor.
2. In Supabase Auth > URL Configuration, add your production Cloudflare URL and `http://localhost:3000` as redirect URLs. Enable email/password sign-in; enable email confirmation for production.
3. Register your administrator once through this app, then run the single commented `update public.profiles` statement in the migration with that email address.
4. Add the public URL and publishable key as Cloudflare build variables. Add `SUPABASE_SERVICE_ROLE_KEY` as an encrypted Cloudflare secret. Do not put the service-role key in GitHub or any `NEXT_PUBLIC_` variable.
5. This is a Next.js 15 app with server routes, so deploy it to Cloudflare Workers (not static Pages). This repository uses the official OpenNext adapter because the current vinext adapter requires a React 19 migration. Configure the GitHub repository `agiedu/studio` as the build source and deploy only after `npm run deploy` passes.

## Security notes

- User documents remain on each user's device in IndexedDB. Supabase currently protects accounts and roles only; it does not upload reading files.
- Delete-user uses a server route and the server-only service role key. Browser users never receive that key.
- The prior browser-local account system cannot safely migrate passwords. Users must create new Supabase passwords.
