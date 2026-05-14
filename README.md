# Kalinga Backend

Staff/admin website and booking API for Kalinga Kitchen & Bar.

## Routes

- `GET /` or `GET /admin` - staff dashboard
- `POST /api/bookings` - customer booking submission
- `GET /api/bookings` - list bookings, requires admin password
- `DELETE /api/bookings/:id` - delete booking, requires admin password
- `GET /api/health` - health check

## Local Development

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000/admin
```

Local admin password:

```text
admin123
```

Local bookings are stored in `bookings.json`. That file is ignored by Git.

## Vercel Environment Variables

Set these in the backend Vercel project:

```text
ADMIN_PASSWORD=choose-a-strong-password
SUPABASE_URL=your-supabase-project-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

Do not put the service role key in the public customer website repo. It belongs only in the backend Vercel environment variables.

## Supabase Table

Create this table in Supabase SQL Editor:

```sql
create table if not exists bookings (
  id bigint primary key,
  name text not null,
  phone text not null,
  booking_date date not null,
  booking_time text not null,
  guests text not null,
  message text default '',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  submitted_at timestamptz not null default now()
);
```

The backend uses the service role key, so customers never connect directly to Supabase.

If your `bookings` table already exists, run this migration before using booking status updates:

```sql
alter table public.bookings
add column if not exists status text not null default 'pending';

do $$
begin
  alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'cancelled'));
exception
  when duplicate_object then null;
end $$;
```

## Customer Website Connection

After deploying this backend, copy its Vercel URL into the customer website repo:

```js
const PRODUCTION_API_BASE_URL = 'https://your-backend-url.vercel.app';
```

That line is near the bottom of the customer `index.html`.
