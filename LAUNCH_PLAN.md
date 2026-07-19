# Melbourne TVs launch plan

Updated: 19 July 2026

## Outcome

Launch a separate Melbourne operation using the proven Brisbane architecture while keeping Melbourne leads, infrastructure, installers, quoting and call handling independent.

## What is already established

- Domain: `melbournetvs.com`, purchased in Tom's Cloudflare account.
- Cloudflare account: Tom's account (`8d813ed7931872a79e12d13a6669b601`).
- D1: `melbournetvs-operations` (`76971043-7ad7-467b-b8a1-d6d57aeab44b`).
- R2: `melbournetvs-lead-uploads`, private.
- Google Sheet: `Melbourne TVs Leads`, workbook ID `12O6g9KC3kw0ayzkaX1-O3NDGmJSBomrCC2WkEJuXYyA`.
- Apps Script project: `Melbourne TVs Lead Receiver`, script ID `1mDrgcj3YXnhRTByiHZdG2buJThY3Y31rX2T4OrH-tscQuHYzWFMMVc8h`.
- Locality research: 534 official localities grouped into nine dispatch zones.
- Page release plan: 74 Tier 1, 276 Tier 2, 137 coverage-only, 47 restricted/quote-only.
- Installer sourcing plan: 12 initial candidates researched; no business has been contacted or represented as appointed.

## Dispatch zones

1. Central & Inner
2. Inner North
3. Inner East
4. Bayside & Inner South-East
5. East & Dandenong Ranges
6. North & Airport
7. West & North-West
8. South-East Growth Corridor
9. Frankston & Mornington Peninsula

The public site can accept an enquiry anywhere in the map, but an appointment is only offered where an approved primary or backup installer is available.

## Installer activation sequence

Start with the highest-evidence candidates in the research shortlist: All Electrics, Copper Fox, Amplified, OZ Secure Tech, GlowTek and Melbourne Antenna Services. Nobody has been contacted yet.

For each dispatch zone:

1. Contact and disclose the managed referral model.
2. Verify ABN/business identity, public liability cover and recent relevant work.
3. Confirm the precise scope they will accept, including screen sizes, wall types, lifting limits, apartments and travel boundary.
4. Verify an electrical licence for any person or business offered fixed electrical work, and cabling registration where regulated cabling is offered.
5. Agree the installer/customer contract, invoicing, deposits, cancellation rules, callbacks and defect handling in writing.
6. Agree a photo-based rate card and exceptions matrix.
7. Run one controlled test job and inspect the customer handover.
8. Approve a primary and backup installer before enabling paid traffic for the zone.

## Commercial model for launch

Use a disclosed managed referral model first: Melbourne TVs coordinates the enquiry and scope; the independent installer is identified before appointment and contracts with/invoices the customer unless a later written agreement changes the model. This keeps responsibility clear while the Melbourne operation proves capacity and quality.

## Website and lead flow

1. Customer submits suburb, TV, wall, contact details and optional photos.
2. Worker validates and saves the lead in Melbourne D1; photos go to private Melbourne R2.
3. The Worker queues delivery to the separate Melbourne Google Sheet.
4. The operator reviews scope and matches an approved installer.
5. Customer receives installer identity, inclusions, exclusions, price and available times in writing.
6. Only after acceptance is an appointment confirmed.

## Go-live gates

### Organic/soft launch

- Website build and link audit pass.
- Quote submission saves to Melbourne D1 and appears in the Melbourne Sheet.
- Privacy and terms pages match the referral model.
- A Melbourne operator can access the sheet and respond reliably.
- At least one approved installer is available for the zones being accepted.

### Paid ads

- Primary and backup installer approved for every advertised zone.
- Melbourne phone/call owner confirmed, tested and written into the escalation process.
- Installer price card and customer-facing pricing approved.
- Insurance/licence/registration evidence stored and current.
- First 10 controlled jobs completed without an unresolved quality or handover problem.
- Conversion tracking and lead-source separation verified.

Do not start the proposed $1,500 campaign merely because the site is live. The paid launch follows the capacity and compliance gates above.

## Current blockers

- Google requires a user to manually complete the unverified-app authorization screen before the Apps Script web-app URL can be issued. This must not be bypassed by automation.
- The Melbourne phone number and the friend/operator's email have not been supplied.
- No installer has yet accepted the operating model or passed the verification checklist.
- Customer-facing Melbourne pricing, warranty and insurance claims have not been approved.

## Research files

- `research/suburbs/MELBOURNE-SUBURB-SERVICE-PLAN.md`
- `research/suburbs/melbourne-suburbs.json`
- `research/market/market-context.md`
- `research/installers/melbourne-installer-sourcing-and-operations-plan.md`
- `research/installers/melbourne-installer-shortlist.csv`
