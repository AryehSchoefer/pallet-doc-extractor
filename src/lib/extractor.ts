import { V2_EXTRACTION_PROMPT } from "../prompts/v2.js";
import type {
	ExtractionResult,
	PalletType,
	PDFPage,
	V2ExtractionData,
	V2PalletMovement,
} from "../types/index.js";
import { analyzeImage, parseJSONResponse, withRetry } from "./ai-client.js";

interface RawV2Response {
	documentType: string;
	perspective: string;
	locationType: string;
	location: {
		name: string | null;
		address: string | null;
	};
	date: string | null;
	palletsGiven: Array<{
		type: string;
		qty: number;
		damaged?: number;
	}>;
	palletsReceived: Array<{
		type: string;
		qty: number;
		damaged?: number;
	}>;
	exchanged: boolean | null;
	references: {
		order: string | null;
		delivery: string | null;
		tour: string | null;
		shipment: string | null;
	};
	parties: {
		sender: { name: string | null; address: string | null };
		recipient: { name: string | null; address: string | null };
	};
	signatures: {
		driver: boolean;
		customer: boolean;
	};
	notes: string[];
	confidence: number;
	warnings: string[];
}

function normalizePalletType(type: string): PalletType {
	const normalized = type.toLowerCase().trim();

	if (
		normalized.includes("eur") ||
		normalized.includes("euro") ||
		normalized === "ep"
	) {
		return "EUR";
	}
	if (
		normalized.includes("düss") ||
		normalized.includes("duss") ||
		normalized === "dd" ||
		normalized === "h1"
	) {
		return "Düsseldorfer";
	}
	if (normalized.includes("chep")) {
		return "CHEP";
	}
	if (normalized.includes("gitter") || normalized === "gb") {
		return "Gitterbox";
	}

	return "unknown";
}

function normalizePalletMovements(
	movements: Array<{ type: string; qty: number; damaged?: number }>,
): V2PalletMovement[] {
	return movements
		.filter((m) => m.qty > 0)
		.map((m) => ({
			type: normalizePalletType(m.type),
			qty: m.qty,
			damaged: m.damaged || 0,
		}));
}

export async function extractPage(
	page: PDFPage,
): Promise<ExtractionResult<V2ExtractionData>> {
	return withRetry(async () => {
		const response = await analyzeImage(page.imageBase64, V2_EXTRACTION_PROMPT);
		const parsed = parseJSONResponse<RawV2Response>(response);

		const data: V2ExtractionData = {
			documentType: parsed.documentType as V2ExtractionData["documentType"],
			perspective: parsed.perspective === "location" ? "location" : "carrier",
			locationType: parsed.locationType === "pickup" ? "pickup" : "delivery",
			location: {
				name: parsed.location?.name || null,
				address: parsed.location?.address || null,
			},
			date: parsed.date || null,
			palletsGiven: normalizePalletMovements(parsed.palletsGiven || []),
			palletsReceived: normalizePalletMovements(parsed.palletsReceived || []),
			exchanged: parsed.exchanged ?? null,
			references: {
				order: parsed.references?.order || null,
				delivery: parsed.references?.delivery || null,
				tour: parsed.references?.tour || null,
				shipment: parsed.references?.shipment || null,
			},
			parties: {
				sender: {
					name: parsed.parties?.sender?.name || null,
					address: parsed.parties?.sender?.address || null,
				},
				recipient: {
					name: parsed.parties?.recipient?.name || null,
					address: parsed.parties?.recipient?.address || null,
				},
			},
			signatures: {
				driver: parsed.signatures?.driver || false,
				customer: parsed.signatures?.customer || false,
			},
			notes: parsed.notes || [],
			confidence: parsed.confidence || 0.5,
			warnings: parsed.warnings || [],
		};

		return {
			success: true,
			data,
			confidence: data.confidence,
			warnings: data.warnings,
			rawResponse: response,
		};
	});
}

export async function extractAllPages(
	pages: PDFPage[],
): Promise<Map<number, ExtractionResult<V2ExtractionData>>> {
	const results = new Map<number, ExtractionResult<V2ExtractionData>>();

	const concurrencyLimit = 3;
	const chunks: PDFPage[][] = [];

	for (let i = 0; i < pages.length; i += concurrencyLimit) {
		chunks.push(pages.slice(i, i + concurrencyLimit));
	}

	for (const chunk of chunks) {
		const chunkResults = await Promise.all(
			chunk.map(async (page) => {
				try {
					const result = await extractPage(page);
					return { pageNumber: page.pageNumber, result };
				} catch (error) {
					console.error(`Failed to extract page ${page.pageNumber}:`, error);
					return {
						pageNumber: page.pageNumber,
						result: {
							success: false,
							confidence: 0,
							warnings: [
								`Extraction failed: ${error instanceof Error ? error.message : String(error)}`,
							],
						} as ExtractionResult<V2ExtractionData>,
					};
				}
			}),
		);

		for (const { pageNumber, result } of chunkResults) {
			results.set(pageNumber, result);
		}
	}

	return results;
}
