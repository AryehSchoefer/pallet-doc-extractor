import { PALETTENNACHWEIS_PROMPT } from "../../prompts/extractors.js";
import type {
	ExtractionResult,
	PalettennachweisData,
	PalletQuality,
	PalletType,
	PDFPage,
} from "../../types/index.js";
import { analyzeImage, parseJSONResponse, withRetry } from "../ai-client.js";

interface RawPalettennachweisResponse {
	date?: string;
	location?: string;
	fromCompany?: string;
	toCompany?: string;
	palletsGiven?: Array<{
		palletType: string;
		quantity: number;
		quality?: string;
	}>;
	palletsReceived?: Array<{
		palletType: string;
		quantity: number;
		quality?: string;
	}>;
	reason?: string;
	signatures?: {
		driver?: boolean;
		customer?: boolean;
	};
	notes?: string[];
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

function normalizeQuality(
	quality: string | undefined,
): PalletQuality | undefined {
	if (!quality) return undefined;

	const normalized = quality.toLowerCase().trim();

	if (normalized === "a" || normalized.includes("a-qual")) {
		return "A";
	}
	if (normalized === "b" || normalized.includes("b-qual")) {
		return "B";
	}
	if (normalized.includes("mix") || normalized.includes("gemischt")) {
		return "mixed";
	}

	return undefined;
}

export async function extractPalettennachweis(
	page: PDFPage,
): Promise<ExtractionResult<PalettennachweisData>> {
	return withRetry(async () => {
		const response = await analyzeImage(
			page.imageBase64,
			PALETTENNACHWEIS_PROMPT,
		);
		const parsed = parseJSONResponse<RawPalettennachweisResponse>(response);

		const data: PalettennachweisData = {
			date: parsed.date || undefined,
			location: parsed.location || undefined,
			fromCompany: parsed.fromCompany || undefined,
			toCompany: parsed.toCompany || undefined,
			palletsGiven: (parsed.palletsGiven || []).map((p) => ({
				palletType: normalizePalletType(p.palletType),
				quantity: p.quantity || 0,
				quality: normalizeQuality(p.quality),
			})),
			palletsReceived: (parsed.palletsReceived || []).map((p) => ({
				palletType: normalizePalletType(p.palletType),
				quantity: p.quantity || 0,
				quality: normalizeQuality(p.quality),
			})),
			reason: parsed.reason || undefined,
			signatures: {
				driver: parsed.signatures?.driver || false,
				customer: parsed.signatures?.customer || false,
			},
			notes: parsed.notes || [],
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
