# What you can try right now

Rewritten after every work package, so it always describes the current state.

**Current state: WP1 complete.** The database exists and the application shell runs. There is no sign-in and no investor data yet — sign-in is the next package.

---

## Starting it from cold

```bash
cd app
pnpm install
cp .env.example .env      # then fill in the two secrets below
pnpm db:migrate           # creates the 41 tables
pnpm db:seed              # creates the users, the round, the defaults
pnpm dev
```

You need a PostgreSQL database running, and `DATABASE_URL` in `.env` pointing at it.

Then open **http://localhost:3000**.

For the two secrets in `.env`, run this twice and paste one value into each:

```bash
openssl rand -base64 32
```

One goes in `ENCRYPTION_KEY`, the other in `AUTH_SECRET`.

---

## What to try, in order

**1. Open the home page.**
You should see a dark navy page, "Flipit Global SPV" in orange capitals above "Investor Portal", and an orange rule beneath it. This is the FLIPIT palette the whole application will use.

**2. Look at the Deployment panel.**
It shows the URL it is serving from, the base path, and whether sending is permitted. Running locally, sending should show in red as **"Blocked — testing deployment, invitations cannot be sent"**, with an explanation below it.

That block is deliberate and it is one of the safeguards. Portal links embed whatever domain issued them, so a link sent from a test deployment stops working the moment the app moves to its real address. The app will only send when its configured URL matches the production one exactly.

**3. Check the footer.**
"Made by Make with Mike" should sit quietly at the bottom in small grey text. It should be easy to miss — that is the intention.

**4. Try the base path.**
Stop the server, then run:

```bash
BASE_PATH=/SPV APP_URL=http://localhost:3000/SPV pnpm dev
```

Now **http://localhost:3000/** should return a 404 and **http://localhost:3000/SPV** should show the page, correctly styled. This is what proves the app can live under `mikehelm.com/SPV` before it moves to `spv.flipit.com`.

**5. Prove it refuses to start when misconfigured.**
Delete the `ENCRYPTION_KEY` line from `.env` and run `pnpm dev` again. It should refuse to start and tell you exactly which variable is wrong. Put it back afterwards.

**6. Check the database was created.**

```bash
psql "$DATABASE_URL" -c "\\dt"
```

You should see 41 tables. Then:

```bash
psql "$DATABASE_URL" -c "select email, role from users;"
```

Three rows — you twice as owner, David once as operator. These come from the allowlist in `.env`; nobody else can sign in later.

**7. Prove the seed is safe to re-run.**

```bash
pnpm db:seed
```

Run it as many times as you like. After the first time it should report nothing, and change nothing.

**8. Run the checks.**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three should pass. 55 tests currently — environment validation, the production-deployment guard, and a set that enforces the data model's structural rules: no floating-point money anywhere, tokens stored only as hashes, investor accounts genuinely durable across rounds, and the register holding no stored ranking.

---

## Not built yet — nothing is broken, it simply is not there

Sign-in · uploading a spreadsheet · the email · sending · the investor portal · questions and answers · reminders · the register of interest · the certificate · the verification page.

---

## Nothing needed from you yet

No credentials or decisions are required to test the above. Sign-in needs nothing from you either — BUILD_SPEC §2.2 dropped Google sign-in, and the first administrator gets in through a one-time setup link rather than an OAuth client. The two things that will eventually need you are a Google **app password** for sending and a compliance approval before any invitation can go out.
