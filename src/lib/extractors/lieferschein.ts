import { LIEFERSCHEIN_PROMPT } from "../../prompts/extractors.js";
import type {
	ExtractionResult,
	LieferscheinData,
	PalletType,
	PDFPage,
} from "../../types/index.js";
import { analyzeImage, parseJSONResponse, withRetry } from "../ai-client.js";

interface RawLieferscheinResponse {
	stammnummer?: string;
	belegnummer?: string;
	tour?: string;
	bestelldatum?: string;
	lieferdatum?: string;
	sender?: {
		name?: string;
		address?: string;
	};
	recipient?: {
		name?: string;
		address?: string;
	};
	items?: Array<{
		description: string;
		quantity: number;
		unit: string;
	}>;
	palletInfo?: Array<{
		palletType: string;
		quantity: number;
		damaged?: number;
	}>;
	corrections?: Array<{
		palletType: string;
		quantity: number;
		damaged?: number;
	}>;
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

export async function extractLieferschein(
	page: PDFPage,
): Promise<ExtractionResult<LieferscheinData>> {
	return withRetry(async () => {
		const response = await analyzeImage(page.imageBase64, LIEFERSCHEIN_PROMPT);
		const parsed = parseJSONResponse<RawLieferscheinResponse>(response);

		const data: LieferscheinData = {
			stammnummer: parsed.stammnummer || undefined,
			belegnummer: parsed.belegnummer || undefined,
			tour: parsed.tour || undefined,
			bestelldatum: parsed.bestelldatum || undefined,
			lieferdatum: parsed.lieferdatum || undefined,
			sender: {
				name: parsed.sender?.name || undefined,
				address: parsed.sender?.address || undefined,
			},
			recipient: {
				name: parsed.recipient?.name || undefined,
				address: parsed.recipient?.address || undefined,
			},
			items: parsed.items || [],
			palletInfo: (parsed.palletInfo || []).map((p) => ({
				palletType: normalizePalletType(p.palletType),
				quantity: p.quantity || 0,
				damaged: p.damaged || 0,
			})),
			corrections: (parsed.corrections || []).map((p) => ({
				palletType: normalizePalletType(p.palletType),
				quantity: p.quantity || 0,
				damaged: p.damaged || 0,
			})),
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
