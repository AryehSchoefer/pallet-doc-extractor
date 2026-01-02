export const V2_CLASSIFIER_PROMPT = `Classify this German logistics document.

## Document Types

| Type | Key Indicators |
|------|----------------|
| lieferschein | "Lieferschein", "Beleg", "Auftrag", structured item list, sender/recipient |
| ladeliste | "Ladeliste", "Ladeschein", "Beladeort", loading list with stops |
| palettennachweis | Two-column pallet exchange, "Sie erhielten"/"Wir erhielten", often handwritten |
| wareneingangsbeleg | "Wareneingang", receipt confirmation, "Palettentausch" table |
| unknown | No match or poor quality |

## Output

Return ONLY valid JSON:

{
  "documentType": "lieferschein|ladeliste|palettennachweis|wareneingangsbeleg|unknown",
  "confidence": 0.0-1.0,
  "references": ["any order/delivery/tour numbers found"],
  "reasoning": "brief explanation"
}`;

export const V2_EXTRACTION_PROMPT = `Extract pallet movement data from this German logistics document.

## Context

Extracting for a CARRIER (trucking company) who:
- Picks up pallets at origin → loads truck
- Delivers pallets to customers
- May exchange (give full, receive empty)

**Documents are written from LOCATION's perspective, not carrier's.**

## Document Types & Perspectives

| Type | Perspective | Location Type |
|------|-------------|---------------|
| lieferschein | carrier | delivery (recipient) |
| ladeliste | carrier | pickup (Beladeort) |
| palettennachweis | location | delivery |
| wareneingangsbeleg | location | delivery |

### Perspective Rules

**palettennachweis** (location writes):
- "Sie erhielten von uns" = location GAVE → carrier RECEIVED
- "Wir erhielten von Ihnen" = location GOT → carrier GAVE

**wareneingangsbeleg** (location writes):
- "Erhaltene Menge" = location GOT → carrier GAVE
- "Zurückgegebene Menge" = location RETURNED → carrier RECEIVED

**ladeliste** (carrier writes):
- Pallets loaded = carrier RECEIVED onto truck
- Beladeort = PICKUP location

**lieferschein** (carrier writes):
- Pallets listed = carrier will GIVE to recipient

## Pallet Types

| Canonical | Aliases |
|-----------|---------|
| EUR | Europalette, Euro-Pal, EP, EUROPALETTE 120X80 |
| Düsseldorfer | DD, H1, Düss |
| CHEP | (blue pallets) |
| Gitterbox | GB, DB-Gitterbox |

## Handwriting

Often handwritten: quantities, dates (DD.MM.YY), "Paletten nicht getauscht", signatures.
Best guess if unclear → add warning.

## Output

Return ONLY valid JSON:

{
  "documentType": "lieferschein|ladeliste|palettennachweis|wareneingangsbeleg",
  "perspective": "carrier|location",
  "locationType": "pickup|delivery",

  "location": {
    "name": "string or null",
    "address": "string or null"
  },

  "date": "DD.MM.YYYY or null",

  "palletsGiven": [
    {"type": "EUR|Düsseldorfer|CHEP|Gitterbox", "qty": 0, "damaged": 0}
  ],
  "palletsReceived": [
    {"type": "EUR|Düsseldorfer|CHEP|Gitterbox", "qty": 0, "damaged": 0}
  ],

  "exchanged": true|false|null,

  "references": {
    "order": "string or null",
    "delivery": "string or null",
    "tour": "string or null",
    "shipment": "string or null"
  },

  "parties": {
    "sender": {"name": "string or null", "address": "string or null"},
    "recipient": {"name": "string or null", "address": "string or null"}
  },

  "signatures": {"driver": false, "customer": false},
  "notes": [],
  "confidence": 0.0-1.0,
  "warnings": []
}

## Field Semantics

**palletsGiven/Received**: From document author's perspective.
- palettennachweis "Wir erhielten 10 EUR" → palletsReceived: [{type:"EUR", qty:10}]
- ladeliste "33 EUROPALETTE loaded" → palletsReceived: [{type:"EUR", qty:33}]

Code will flip given↔received for location-perspective docs.

**exchanged**:
- true = exchange happened
- false = "Paletten nicht getauscht"
- null = unknown

**locationType**:
- pickup = Beladeort, origin
- delivery = recipient, customer`;
