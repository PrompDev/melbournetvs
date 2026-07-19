import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..", "..");
const datasetPath = path.join(projectRoot, "research", "suburbs", "melbourne-suburbs.json");
const outputDir = path.join(here, "..", "src", "content", "locations");

const { suburbs } = JSON.parse(await readFile(datasetPath, "utf8"));
const launchSuburbs = suburbs.filter(
  (suburb) => suburb.priority === 1 && suburb.index_recommendation === true,
);
const slugByName = new Map(suburbs.map((suburb) => [suburb.name, suburb.slug]));
const yaml = (value) => JSON.stringify(value);

await mkdir(outputDir, { recursive: true });

for (const suburb of launchSuburbs) {
  const nearby = suburb.nearby_areas
    .map((name) => slugByName.get(name))
    .filter(Boolean);
  const housing = [suburb.property_profile];
  const description = `TV wall mounting enquiries in ${suburb.name}, ${suburb.lga}. Send wall and TV photos for a written scope, local availability check and firm quote.`;
  const faq = [
    {
      q: `Is TV mounting available in ${suburb.name}?`,
      a: `Send the address, TV size and wall photos first. We will confirm installer coverage in ${suburb.name}, the scope and a written price before offering an appointment.`,
    },
    {
      q: "Can the installer add or move a power point?",
      a: "New or relocated fixed electrical work must be completed by a Victorian licensed electrician. We identify that requirement separately when reviewing your photos.",
    },
    {
      q: "Who completes the work?",
      a: "Melbourne TVs is launching as a managed referral and booking service. The assigned independent installer is disclosed before the appointment and confirms the final job scope.",
    },
  ];

  const content = `---
title: ${yaml(`TV Wall Mounting ${suburb.name} | Melbourne TVs`)}
description: ${yaml(description)}
heroImage: ${yaml("/media/mounting-big-tv-on-brick-hero.jpg")}
heroAlt: ${yaml("Large television being carefully positioned on a wall bracket")}
publishDate: 2026-07-19
suburb: ${yaml(suburb.name)}
region: ${yaml(suburb.zone)}
latitude: ${suburb.latitude}
longitude: ${suburb.longitude}
commonHousingStock: ${yaml(housing)}
nearbySuburbs: ${yaml(nearby)}
servicesOffered: ${yaml(["tv-wall-mounting", "cable-concealment", "soundbar-installation"])}
faq: ${JSON.stringify(faq, null, 2)}
tags: ${yaml(["melbourne", suburb.slug, "tv-wall-mounting"])}
draft: true
---

## Planning a TV mount in ${suburb.name}

${suburb.local_context}

For an accurate quote, send a front-on photo of the wall, the TV make and size, the bracket if you already have one, and any access notes. We check the wall type, lift requirements, cable plan and local installer availability before confirming the job.

## Local scheduling notes

${suburb.service_notes}

This page is staged for launch but remains unpublished until a primary and backup installer have been verified for the ${suburb.zone} dispatch zone.

## Scope and trade boundaries

Standard mounting can include bracket positioning, suitable mechanical fixings, levelling and connection to existing outlets. Any new or relocated fixed power must be completed by a licensed electrician. Regulated communications cabling must be completed by an appropriately registered cabler.

[Send photos for a written quote](/quote/)
`;

  await writeFile(path.join(outputDir, `${suburb.slug}.md`), content, "utf8");
}

console.log(`Generated ${launchSuburbs.length} staged Melbourne location pages.`);
