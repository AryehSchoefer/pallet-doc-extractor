import { WARENEINGANGSBELEG_PROMPT } from "../../prompts/extractors.js";
import type {
	ExtractionResult,
	PalletType,
	PDFPage,
	WareneingangselegData,
} from "../../types/index.js";
import { analyzeImage, parseJSONResponse, withRetry } from "../ai-client.js";

interface RawWareneingangselegResponse {
	date?: string;
	receiptNumber?: string;
	deliveryNumber?: string;
	supplier?: string;
	palletExchange?: Array<{
		palletType: string;
		received: number;
		returned: number;
		saldo: number;
	}>;
	confirmed?: boolean;
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

export async function extractWareneingangsbeleg(
	page: PDFPage,
): Promise<ExtractionResult<WareneingangselegData>> {
	return withRetry(async () => {
		const response = await analyzeImage(
			page.imageBase64,
			WARENEINGANGSBELEG_PROMPT,
		);
		const parsed = parseJSONResponse<RawWareneingangselegResponse>(response);

		const data: WareneingangselegData = {
			date: parsed.date || undefined,
			receiptNumber: parsed.receiptNumber || undefined,
			deliveryNumber: parsed.deliveryNumber || undefined,
			supplier: parsed.supplier || undefined,
			palletExchange: (parsed.palletExchange || []).map((p) => ({
				palletType: normalizePalletType(p.palletType),
				received: p.received || 0,
				returned: p.returned || 0,
				saldo: p.saldo ?? (p.received || 0) - (p.returned || 0),
			})),
			confirmed: parsed.confirmed || false,
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
