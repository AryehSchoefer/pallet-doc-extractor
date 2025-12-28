export const CLASSIFICATION_PROMPT = `You are analyzing a German logistics document image. Your task is to classify this document page and extract key identifiers.

## Document Types

1. **lieferschein** (Delivery Note)
   - Usually printed, structured business document
   - Contains: order numbers, dates, addresses, item lists
   - May have "Lieferschein", "Beleg", "Auftrag" in header
   - Often has "Ladungsträger" or pallet sections

2. **ladeliste** (Loading List)
   - Shows what was loaded onto the truck
   - Lists multiple stops/deliveries
   - Contains pallet counts per stop
   - May have handwritten annotations

3. **palettennachweis** (Pallet Receipt)
   - Often handwritten or partially handwritten
   - Two-column format: "Sie erhielten von..." vs "Wir erhielten von Ihnen"
   - Shows pallet exchange at a specific location
   - Has checkboxes for reasons (Kein Palettenvorrat, etc.)

4. **wareneingangsbeleg** (Goods Receipt)
   - Confirmation from receiving party
   - Contains "Wareneingang" in header
   - "Palettentausch / Leergutrückgabe" section
   - Shows exchange quantities

5. **unknown**
   - Document doesn't match any known type
   - Or quality too poor to determine

## Your Response

Return ONLY valid JSON in this exact format:
{
  "documentType": "lieferschein" | "ladeliste" | "palettennachweis" | "wareneingangsbeleg" | "unknown",
  "confidence": 0.0 to 1.0,
  "identifiers": {
    "orderNumbers": ["any order/delivery/reference numbers found"],
    "dates": ["any dates found in DD.MM.YYYY format"],
    "companies": ["any company names found"]
  },
  "reasoning": "Brief explanation of classification"
}

## Important Notes

- This document is in German
- It may contain handwritten text in addition to printed text
- Look for key terms like "Lieferschein", "Palettennachweis", "Ladeliste", "Wareneingang"
- Extract ALL reference numbers you can find (order numbers, delivery numbers, tour numbers, etc.)
- If confidence is below 0.5, classify as "unknown"`;

export const HANDWRITING_NOTE = `
Note: This document may contain handwritten entries in addition to printed text.
Handwritten text is typically found in:
- Quantity fields (numbers like "33")
- Date fields (format: DD.MM.YY or DD.MM.YYYY)
- Signature areas
- Notes/remarks sections

Pay special attention to handwritten numbers which may be unclear.
If uncertain about a value, provide your best interpretation.`;

export const GERMAN_FORMAT_NOTE = `
German logistics documents vary significantly in format.
Look for semantic meaning rather than exact field labels.

Pallet types may be labeled as:
- "Europaletten", "EUR-Palette", "Euro-Pal.", "EUR", "EP"
- "Düsseldorfer", "DD", "H1"
- "CHEP" (blue pallets)
- "Gitterbox", "GB", "DB-Gitterbox"

Dates may appear as:
- "13.11.2025", "13.11.25"
- "Lieferdatum:", "Datum:", "Date:"

Quantities may have units like:
- "Stück", "Stk.", "St."
- Or just plain numbers`;
