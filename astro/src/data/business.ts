/**
 * Melbourne TVs public contact and quoting configuration.
 *
 * A Melbourne phone number and installer price card have not been approved.
 * Until they are, every public CTA goes to the written quote flow and prices
 * remain quote-based. This avoids sending Melbourne leads to Brisbane.
 */
export const BUSINESS = {
  name: "Melbourne TVs",
  phoneDisplay: "Request a callback",
  phoneTel: "/quote/",
  email: "admin@melbournetvs.com",
  mailto: "mailto:admin@melbournetvs.com",
  hoursDisplay: "Online enquiries open 7 days",
  webhooks: {
    quickQuote: "/api/n8n/lead",
    photoQuote: "/api/website-lead",
    callBack: "/api/n8n/lead",
    emailSignup: "/api/n8n/lead",
    bookingRequest: "/api/n8n/lead",
  },
} as const;

export type Package = {
  id: string;
  name: string;
  tagline: string;
  sizeMin: number;
  sizeMax: number | null;
  sizeLabel: string;
  priceAud: number | null;
  priceLabel: string;
  highlights: string[];
  ctaLabel: string;
};

export const PACKAGES: Package[] = [
  {
    id: "standard",
    name: "Standard TV Mount",
    tagline: "Bedrooms, living rooms and straightforward wall types.",
    sizeMin: 32,
    sizeMax: 65,
    sizeLabel: "32-65 inch",
    priceAud: null,
    priceLabel: "Written quote",
    highlights: [
      "Fixed or tilt mounting options",
      "Wall, TV and bracket checked before confirmation",
      "Cable-management options itemised",
      "Appointment offered after local installer availability is confirmed",
    ],
    ctaLabel: "Request a written quote",
  },
  {
    id: "large",
    name: "Large TV Mount",
    tagline: "Larger screens that need a heavier bracket and safe lift plan.",
    sizeMin: 66,
    sizeMax: 85,
    sizeLabel: "66-85 inch",
    priceAud: null,
    priceLabel: "Written quote",
    highlights: [
      "Bracket and wall construction checked first",
      "Crew requirements confirmed before booking",
      "Cable-management options itemised",
      "Photos help us return a firm scope faster",
    ],
    ctaLabel: "Quote a large TV",
  },
  {
    id: "oversize",
    name: "Oversize & Specialist Mount",
    tagline: "Very large screens, fireplaces and unusual surfaces.",
    sizeMin: 86,
    sizeMax: null,
    sizeLabel: "86 inch +",
    priceAud: null,
    priceLabel: "Site-specific quote",
    highlights: [
      "Wall and access assessment",
      "Bracket and anchor specification",
      "Lift and crew plan",
      "Licensed trade work identified separately where required",
    ],
    ctaLabel: "Request a specialist quote",
  },
];

export function packageForSize(inches: number): Package {
  const match = PACKAGES.find(
    (pkg) => inches >= pkg.sizeMin && (pkg.sizeMax === null || inches <= pkg.sizeMax),
  );
  return match ?? PACKAGES[0];
}
