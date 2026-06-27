# RoadWatch Ghana 🚧

**Road Safety Intelligence Platform**
Report hazards · Check routes · Close the civic loop

---

## Stack

| Layer       | Tech                              | Cost  |
|-------------|-----------------------------------|-------|
| Framework   | Next.js 15 (App Router)           | Free  |
| Language    | TypeScript                        | Free  |
| Database    | PostgreSQL on Neon                | Free  |
| ORM         | Prisma                            | Free  |
| AI          | Gemini 1.5 Flash (transcription)  | Free* |
| Storage     | Supabase (photos + audio)         | Free  |
| Auth        | iron-session (cookie sessions)    | Free  |
| Hosting     | Vercel                            | Free  |
| Maps        | MapLibre GL + OpenFreeMap tiles   | Free  |

*Gemini free tier: 15 requests/min, 1M tokens/day

---

## Project Structure

```
roadwatch/
├── app/
│   ├── (public)/          ← Citizen app (roadwatch.gh)
│   │   └── page.tsx       ← Areas, Route Check, Fixed tabs
│   ├── (admin)/           ← Admin portal (admin.roadwatch.gh)
│   │   ├── login/
│   │   └── dashboard/
│   ├── api/
│   │   ├── reports/       ← GET all, POST new
│   │   │   └── [id]/
│   │   │       ├── route.ts      ← PATCH status
│   │   │       └── upvote/       ← POST confirm
│   │   ├── transcribe/    ← POST audio → Gemini → JSON
│   │   └── auth/          ← POST login, DELETE logout
│   ├── globals.css
│   └── layout.tsx
├── lib/
│   ├── db.ts              ← Prisma singleton
│   ├── session.ts         ← iron-session helper
│   ├── gemini.ts          ← Transcription + classification
│   ├── confidence.ts      ← Confidence model
│   ├── areas.ts           ← Area definitions + route matching
│   └── useVoice.ts        ← MediaRecorder hook
├── types/
│   └── index.ts           ← All shared TypeScript types
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── public/
│   ├── manifest.json      ← PWA manifest
│   └── icons/
├── middleware.ts          ← Protects /admin/* routes
└── .env.example
```

---

## Setup

### 1. Clone and install
```bash
git clone https://github.com/yourname/roadwatch.git
cd roadwatch
npm install
```

### 2. Environment variables
```bash
cp .env.example .env.local
```
Fill in:
- `DATABASE_URL` — from [neon.tech](https://neon.tech)
- `DIRECT_URL` — same as DATABASE_URL for Neon
- `GEMINI_API_KEY` — from [aistudio.google.com](https://aistudio.google.com)
- `NEXT_PUBLIC_SUPABASE_URL` — from [supabase.com](https://supabase.com)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Supabase
- `SUPABASE_SERVICE_KEY` — from Supabase
- `SESSION_SECRET` — run `openssl rand -hex 32`

### 3. Database
```bash
npm run db:push    # Push schema to Neon
npm run db:seed    # Seed with Accra pilot data
```

### 4. Run
```bash
npm run dev
```

Public app:  http://localhost:3000
Admin login: http://localhost:3000/admin/login

**Admin credentials (from seed):**
- Email: `admin@roadwatch.gh`
- Password: `roadwatch2024`

---

## Supabase Storage Setup

Create two buckets in Supabase:
- `report-photos` — public, 5MB max, images only
- `report-audio`  — public, 10MB max, audio only

RLS policy for both (allow public uploads):
```sql
CREATE POLICY "Public uploads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id IN ('report-photos', 'report-audio'));
```

---

## Deployment (Vercel)

```bash
npx vercel
```

Set all environment variables in Vercel dashboard.

For admin subdomain: Add `admin.roadwatch.gh` as a custom domain in Vercel
and configure your DNS accordingly.

---

## Voice Reporting Flow

1. User holds mic button in chat
2. `useVoice` hook captures audio via MediaRecorder API
3. Audio blob → base64 → POST `/api/transcribe`
4. Gemini 1.5 Flash transcribes + classifies in Twi/Ga/English/Ewe
5. Returns `{ transcript, hazardType, severity, locationHint }`
6. Bot shows: *"I heard: Pothole on Spintex Road, High severity — is that right?"*
7. User confirms or corrects via chips
8. Report submitted with both transcript and original audio URL

---

## Confidence Model

| Signal           | Level     | Visible in Areas/Route |
|------------------|-----------|------------------------|
| No photo         | Unverified | ❌                     |
| Photo attached   | Reported   | ✅                     |
| Admin verified   | Verified   | ✅                     |
| 3+ confirmations | Confirmed  | ✅ (max priority)       |

---

## Admin Credentials (change in production!)

```
admin@roadwatch.gh / roadwatch2024     ← SUPER_ADMIN
moderator@roadwatch.gh / moderator2024 ← MODERATOR
```

Run this to create a new admin:
```bash
npx prisma studio
```
Or via API — add a proper admin creation endpoint before going to production.
