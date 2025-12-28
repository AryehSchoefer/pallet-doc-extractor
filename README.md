# pallet-doc-extractor

Extracts pallet movements from German logistics PDFs. Handles Lieferschein, Ladeliste, Palettennachweis, Wareneingangsbeleg. Outputs JSON + Excel with per-stop breakdown and saldo calculation.

## Setup

```bash
pnpm install
cp .env.example .env  # add OPENROUTER_API_KEY
```

## Usage

```bash
# single PDF
pnpm extract -- --input ./doc.pdf --output ./out

# batch directory
pnpm extract:batch -- --input ./pdfs --output ./out

# generate Excel from existing JSON
pnpm generate:excel -- --input ./out
```

## Output

Per delivery:
- `*_extraction.json` - raw classified pages + stop data
- `*_result.json` - final pallet movements

Batch:
- `combined_results.xlsx` - all deliveries, one row per pallet type per stop
- `batch_summary.json`

### Pallet Movement Fields

| Field | Description |
|-------|-------------|
| pickupReceived | pallets loaded at pickup |
| pickupGiven | pallets returned at pickup |
| deliveryReceived | pallets received from customer |
| deliveryGiven | pallets handed to customer |
| saldo | carrier debt = pickupGiven - pickupReceived |

## Structure

```
src/
├── index.ts              # single PDF entry
├── batch.ts              # batch processing
├── generate-excel.ts     # standalone Excel gen
├── lib/
│   ├── pdf-processor.ts  # PDF → images
│   ├── classifier.ts     # page classification + grouping
│   ├── correlator.ts     # multi-doc correlation → stops
│   ├── output-generator.ts
│   ├── ai-client.ts      # Gemini via OpenRouter
│   └── extractors/       # per-doc-type extraction
├── prompts/              # AI prompts
└── types/
```

## Supported Pallets

EUR, Düsseldorfer, CHEP, Gitterbox
