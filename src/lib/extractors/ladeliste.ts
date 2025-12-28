import { LADELISTE_PROMPT } from "../../prompts/extractors.js";
import type {
	ExtractionResult,
	LadelisteData,
	PalletType,
	PDFPage,
} from "../../types/index.js";
import { analyzeImage, parseJSONResponse, withRetry } from "../ai-client.js";

interface RawLadelisteResponse {
	tour?: string;
	date?: string;
	vehiclePlate?: string;
	driver?: string;
	stops?: Array<{
		stopNumber: number;
		customerName?: string;
		address?: string;
		pallets?: Array<{
			palletType: string;
			quantity: number;
		}>;
	}>;
	totalPallets?: Array<{
		palletType: string;
		quantity: number;
	}>;
	handwrittenNotes?: string[];
	confidence?: number;
	warnings?: string[];
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

export async function extractLadeliste(
	page: PDFPage,
): Promise<ExtractionResult<LadelisteData>> {
	return withRetry(async () => {
		const response = await analyzeImage(page.imageBase64, LADELISTE_PROMPT);
		const parsed = parseJSONResponse<RawLadelisteResponse>(response);

		const data: LadelisteData = {
			tour: parsed.tour || undefined,
			date: parsed.date || undefined,
			vehiclePlate: parsed.vehiclePlate || undefined,
			driver: parsed.driver || undefined,
			stops: (parsed.stops || []).map((stop) => ({
				stopNumber: stop.stopNumber || 0,
				customerName: stop.customerName || undefined,
				address: stop.address || undefined,
				pallets: (stop.pallets || []).map((p) => ({
					palletType: normalizePalletType(p.palletType),
					quantity: p.quantity || 0,
				})),
			})),
			totalPallets: (parsed.totalPallets || []).map((p) => ({
				palletType: normalizePalletType(p.palletType),
				quantity: p.quantity || 0,
			})),
			handwrittenNotes: parsed.handwrittenNotes || [],
		};

		return {
			success: true,
			data,
			confidence: parsed.confidence || 0.5,
			warnings: parsed.warnings || [],
			rawResponse: response,
		};
	});
}
