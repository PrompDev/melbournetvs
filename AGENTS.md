# Melbourne TVs repository instructions

Read `README.md` and `LAUNCH_PLAN.md` before changing production behaviour.

## Sources of truth

- Public site: `astro/`
- Homepage: `astro/public/index.html`
- Public business/contact facts: `astro/src/data/business.ts`
- Lead API: `workers/lead-worker.js` and `functions/api/website-lead.js`
- Google Sheet receiver: `integrations/google-apps-script/Code.gs`
- Official locality routing data: `research/suburbs/melbourne-suburbs.json`
- Generated launch suburb pages: `astro/src/content/locations/`

## Rules

- Do not copy Brisbane customers, phone numbers, credentials, analytics IDs or Apps Script URLs into this project.
- Keep unverified suburb pages as drafts until a primary and backup installer are approved for their dispatch zone.
- Do not publish price, response-time, insurance, review or warranty claims without Melbourne-specific evidence and owner approval.
- Do not describe ordinary TV mounting as licensed electrical work. Route any new or relocated fixed power to a Victorian licensed electrician and regulated cabling to an appropriately registered cabler.
- Run the Astro build, link audit, Worker tests and Wrangler dry run before deployment.
- Never commit secrets. Cloudflare Worker secrets belong in Wrangler-managed secret storage.
