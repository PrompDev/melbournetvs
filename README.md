# Melbourne TVs

Melbourne-specific TV mounting website and lead operations, derived from the current Brisbane TVs production architecture without sharing customer data, phone routing or operational credentials.

## Production surfaces

- Website source: `astro/`
- Homepage: `astro/public/index.html`
- Lead Worker: `workers/lead-worker.js`
- Lead receiver: `integrations/google-apps-script/Code.gs`
- Suburb dataset and launch tiers: `research/suburbs/`
- Installer research: `research/installers/`
- Market and compliance context: `research/market/`

Astro builds the static site into `astro/dist`. The Melbourne Worker deploys those static assets and the `/api/*` lead routes together on the root and `www` custom domains. Leads are stored in a dedicated D1 database and private uploads in a dedicated R2 bucket.

## Local verification

```text
cd astro
pnpm install --frozen-lockfile
pnpm run build

cd ../workers
npm ci
npx wrangler types
npm test
npm run deploy:dry
```

## Launch safety

- The 74 first-release suburb pages are generated with `draft: true` until installer capacity is verified.
- Public pricing remains quote-based until the Melbourne installer price card is approved.
- No Melbourne phone number is published yet; public CTAs use the written quote flow.
- New or relocated fixed electrical work requires a Victorian licensed electrician.
- Applicable regulated communications cabling requires an appropriately registered cabler.
- During launch, Melbourne TVs is presented as a managed booking/referral service and the independent installer is disclosed before appointment.

See `LAUNCH_PLAN.md` for the operating sequence and go-live gates.
