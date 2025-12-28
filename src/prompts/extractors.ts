import { GERMAN_FORMAT_NOTE, HANDWRITING_NOTE } from "./classifier.js";

export const LIEFERSCHEIN_PROMPT = `You are extracting data from a German Lieferschein (delivery note).

${HANDWRITING_NOTE}
${GERMAN_FORMAT_NOTE}

## Extract the following information:

### Header/Reference Numbers
- Stammnummer (master number)
- Belegnummer (document number)
- Tour (route number)
- Auftragsnummer (order number)
- Any other reference numbers

### Dates
- Bestelldatum (order date)
- Lieferdatum (delivery date)

### Addresses
- Sender (Versender/Absender): company name and full address
- Recipient (Empfänger): company name and full address

### Pallet Information
Look for sections labeled:
- "Ladungsträger" (load carriers)
- "Voll-/Leergut-Korrekturen" (full/empty goods corrections)
- Any table with pallet types and quantities

For each pallet type, extract:
- Type (EUR, Düsseldorfer, CHEP, Gitterbox)
- Quantity
- Whether damaged (beschädigt) if noted

### Items (if visible)
- Description
- Quantity
- Unit

## Response Format

Return ONLY valid JSON:
{
  "stammnummer": "string or null",
  "belegnummer": "string or null",
  "tour": "string or null",
  "bestelldatum": "DD.MM.YYYY or null",
  "lieferdatum": "DD.MM.YYYY or null",
  "sender": {
    "name": "company name or null",
    "address": "full address or null"
  },
  "recipient": {
    "name": "company name or null",
    "address": "full address or null"
  },
  "items": [
    {"description": "string", "quantity": number, "unit": "string"}
  ],
  "palletInfo": [
    {"palletType": "EUR|Düsseldorfer|CHEP|Gitterbox|unknown", "quantity": number, "damaged": number or 0}
  ],
  "corrections": [
    {"palletType": "EUR|Düsseldorfer|CHEP|Gitterbox|unknown", "quantity": number, "damaged": number or 0}
  ],
  "confidence": 0.0 to 1.0,
  "warnings": ["any issues or uncertainties"]
}`;

export const PALETTENNACHWEIS_PROMPT = `You are extracting data from a German Palettennachweis (pallet receipt/exchange document).

${HANDWRITING_NOTE}
${GERMAN_FORMAT_NOTE}

## Document Structure

This document typically has a two-column layout showing pallet exchange:
- Left side: "Sie erhielten von [Company]" (You received from [Company])
- Right side: "Wir erhielten von Ihnen" (We received from you)

## Extract the following:

### Header Information
- Date of exchange
- Location/Address
- Companies involved (from company, to company)

### Pallet Exchange - Left Column ("Sie erhielten von uns" / "Überlassen")
For each pallet type, the quantity given TO the other party:
- Europaletten / EUR
- Düsseldorfer / DD / H1
- Gitterbox / GB
- CHEP
- Note quality (A or B) if specified

### Pallet Exchange - Right Column ("Wir erhielten von Ihnen" / "Übernommen")
For each pallet type, the quantity received FROM the other party:
- Same types as above

### Reason Checkboxes
Look for checked reasons like:
- "Kein Palettenvorrat" (No pallet stock)
- "Fahrer hat Rücknahme verweigert" (Driver refused return)
- "Ware nicht palettiert angeliefert" (Goods delivered without pallets)

### Signatures
- Driver signature present?
- Customer/warehouse signature present?

### Notes
Any handwritten notes or annotations

## Response Format

Return ONLY valid JSON:
{
  "date": "DD.MM.YYYY or null",
  "location": "address/location or null",
  "fromCompany": "company giving pallets or null",
  "toCompany": "company receiving pallets or null",
  "palletsGiven": [
    {"palletType": "EUR|Düsseldorfer|CHEP|Gitterbox|unknown", "quantity": number, "quality": "A|B|mixed|null"}
  ],
  "palletsReceived": [
    {"palletType": "EUR|Düsseldorfer|CHEP|Gitterbox|unknown", "quantity": number, "quality": "A|B|mixed|null"}
  ],
  "reason": "checked reason or null",
  "signatures": {
    "driver": true/false,
    "customer": true/false
  },
  "notes": ["any additional notes"],
  "confidence": 0.0 to 1.0,
  "warnings": ["any issues or uncertainties"]
}

## Important
- Pay close attention to handwritten numbers - they are critical for pallet counts
- If a field has a handwritten number that's unclear, make your best guess and add a warning
- Quality grades (A/B) may be indicated by checkboxes, letters, or position in table`;

export const WARENEINGANGSBELEG_PROMPT = `You are extracting data from a German Wareneingangsbeleg (goods receipt document).

${HANDWRITING_NOTE}
${GERMAN_FORMAT_NOTE}

## Document Structure

This is a confirmation document from the receiving party (usually a warehouse or store).
Look for a "Palettentausch / Leergutrückgabe" (Pallet exchange / Empty goods return) section.

## Extract the following:

### Header Information
- Date
- Receipt number (Belegnummer)
- Delivery number (Lieferschein-Nr, Sendungsnummer)
- Supplier name

### Pallet Exchange Table
Usually structured as:
| Verpackungsart | Erhaltene Menge | Zurückgegebene Menge | Saldo |
| (Packing type) | (Received qty)  | (Returned qty)       | (Balance) |

For each pallet type extract:
- palletType: EUR, Düsseldorfer, CHEP, Gitterbox
- received: quantity received
- returned: quantity returned
- saldo: balance (or calculate as received - returned)

### Confirmation
- Is the receipt signed/confirmed?
- Any stamps present?

### Notes
Any handwritten notes or annotations about damaged pallets, disputes, etc.

## Response Format

Return ONLY valid JSON:
{
  "date": "DD.MM.YYYY or null",
  "receiptNumber": "string or null",
  "deliveryNumber": "string or null",
  "supplier": "string or null",
  "palletExchange": [
    {
      "palletType": "EUR|Düsseldorfer|CHEP|Gitterbox|unknown",
      "received": number,
      "returned": number,
      "saldo": number
    }
  ],
  "confirmed": true/false,
  "notes": ["any additional notes"],
  "confidence": 0.0 to 1.0,
  "warnings": ["any issues or uncertainties"]
}`;

export const LADELISTE_PROMPT = `You are extracting data from a German "Ladeliste" / "Ist-Ladeliste" / "Ladeschein" (loading list) document.

${HANDWRITING_NOTE}
${GERMAN_FORMAT_NOTE}

## Document Purpose

This document shows what goods are being loaded onto a truck and WHERE the loading happens.
The loading location is the PICKUP location - this is critical to extract correctly!

## CRITICAL FIELD - Beladeort (PICKUP Location)

**This is the MOST IMPORTANT field to extract!**

The "Beladeort" field shows the PICKUP/LOADING location where the truck picks up cargo.
- Look for: "Beladeort:", "Belade-Ort:", "Ladestelle:", or a location near the top of the document
- Common format: "AL [City] [Street] [PLZ] [City]"
- Example: "AL Bockenem Walter-Althoff-Straße 1b 31167 Bockenem"
- "AL" often means "Abhollager" (pickup warehouse)

**This is NOT the delivery destination!**

## Fields to Extract

### Header/Reference Numbers
- Sendungsnummer (shipment number)
- Ladenummer (loading number) - may be the tour number
- Belegnummer (document number)
- SAP-Bestellnummer (SAP order number)

### Dates - IMPORTANT DISTINCTION
- Druckdatum (print date) - This is often the PICKUP date or close to it!
- Lieferdatum (delivery date) - When goods arrive at final destination
- Pickup date is typically 1 day BEFORE Lieferdatum

### Vehicle/Driver
- Fahrer (driver name/ID)
- LKW (truck ID)
- KFZ-Kennzeichen (vehicle plate number)

### Ladungsträger (Pallets/Load Carriers)
Look for a "Ladungsträger" section showing what is loaded:
- "EUROPALETTE 120X80" = EUR pallet
- "Düsseldorfer" = Düsseldorfer pallet
- "CHEP" = CHEP pallet
- "Gitterbox" = Gitterbox

### Handwritten Notes
Often at the bottom:
- Pallet exchange status: "Paletten getauscht" (exchanged) or "Paletten nicht getauscht" (not exchanged)
- Handwritten pallet counts
- Dates near signatures

## Example Document

\`\`\`
Druckdatum/Uhrzeit: 12.11.2025/10:33:12  Seite:1/1
Ist - Ladeliste    NACHDRUCK           LA [Coca-Cola logo]

Beladeort:       AL Bockenem Walter-Althoff-Straße 1b 31167 Bockenem

Sendungsnummer:  0000075167
Belegnummer:     #
SAP-Bestellnummer 25499219

Ladenummer:      0006306122         Lieferdatum:    13.11.2025
Fahrer:          0899050218 TMB EW 0633
LKW:             0021403006         KFZ-Kennz.:     rzd 3422

Ladungsträger
Art.-Nr.    Artikelname              Ist - LT
356         EUROPALETTE 120X80       33
\`\`\`

## Response Format

Return ONLY valid JSON:
{
  "tour": "string - from Ladenummer field",
  "date": "DD.MM.YYYY - Lieferdatum (delivery date)",
  "pickupDate": "DD.MM.YYYY - from Druckdatum or handwritten date (pickup date)",
  "vehiclePlate": "string - from KFZ-Kennz. field",
  "driver": "string - from Fahrer field",
  "beladeort": {
    "name": "string - Location name (e.g., 'AL Bockenem' or 'Coca Cola Bockenem')",
    "address": "string - Full address (e.g., 'Walter-Althoff-Straße 1b, 31167 Bockenem')"
  },
  "sendungsnummer": "string or null",
  "stops": [
    {
      "stopNumber": number,
      "customerName": "string or null",
      "address": "string or null",
      "pallets": [
        {"palletType": "EUR|Düsseldorfer|CHEP|Gitterbox|unknown", "quantity": number}
      ]
    }
  ],
  "totalPallets": [
    {"palletType": "EUR|Düsseldorfer|CHEP|Gitterbox|unknown", "quantity": number}
  ],
  "handwrittenNotes": ["any handwritten annotations"],
  "pallettenNichtGetauscht": true/false if "Paletten nicht getauscht" appears,
  "confidence": 0.0 to 1.0,
  "warnings": ["any issues or uncertainties"]
}

## Expected Extraction for Example Above

{
  "tour": "0006306122",
  "date": "13.11.2025",
  "pickupDate": "12.11.2025",
  "vehiclePlate": "rzd 3422",
  "driver": "0899050218 TMB EW 0633",
  "beladeort": {
    "name": "AL Bockenem",
    "address": "Walter-Althoff-Straße 1b, 31167 Bockenem"
  },
  "sendungsnummer": "0000075167",
  "stops": [],
  "totalPallets": [
    {"palletType": "EUR", "quantity": 33}
  ],
  "handwrittenNotes": [],
  "confidence": 1.0,
  "warnings": []
}

## Critical Reminders
1. The "Beladeort" is the PICKUP location - extract name AND address separately
2. "Druckdatum" (print date) is often the pickup date or very close to it
3. "Lieferdatum" is the DELIVERY date, not pickup
4. "EUROPALETTE 120X80" = EUR pallet type
5. If "Paletten nicht getauscht" appears, note this - it means no pallet exchange happened`;
