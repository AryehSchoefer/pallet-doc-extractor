import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { env } from "../env.js";
import { buildExtractionPrompt } from "../prompts/extraction.js";
import type {
	PageClassification,
	PDFPage,
	TwoPassCarrier,
	TwoPassConfig,
	TwoPassExchangeStatus,
	TwoPassExtractionResult,
	TwoPassReferences,
	TwoPassStopInfo,
	V010PalletType,
} from "../types/index.js";
import { parseJSONResponse, withRetry } from "./ai-client.js";
import { buildDocumentContext } from "./classifier.js";
import { DEFAULT_CONFIG } from "./config.js";

interface RawExtractionResponse {
	pickup: {
		date: string | null;
		time: string | null;
		location: string | null;
		address: string | null;
		warehouseId?: string | null;
		übernommen: number;
		überlassen: number;
	};
	delivery: {
		date: string | null;
		time: string | null;
		location: string | null;
		address: string | null;
		warehouseId?: string | null;
		überlassen: number;
		übernommen: number;
	};
	palletType: string;
	saldo: number;
	carrier: {
		name: string | null;
		licensePlate: string | null;
		driverCode?: string | null;
		driverName?: string | null;
	};
	references: {
		sendungsnummer?: string | null;
		lieferscheinNr?: string | null;
		ladenummer?: string | null;
		dplVoucherNr?: string | null;
		tourNr?: string | null;
	};
	exchangeStatus: {
		exchanged: boolean | null;
		partial?: boolean;
		comment?: string | null;
		dplIssued?: boolean;
		nonExchangeReason?: string | null;
	};
	confidence: number;
	notes?: string | null;
}

const VALID_PALLET_TYPES: V010PalletType[] = [
	"EURO-Palette",
	"EUR",
	"EUR-NT",
	"Einweg-Palette",
	"Einweg",
	"Düsseldorfer",
	"CHEP",
	"CHEP-HALB",
	"CHEP-VIERTEL",
	"Gitterbox",
	"Plastik",
	"H1",
	"Rollcontainer",
	"Industrie-Palette",
	"Industrie",
	"unknown",
];

function normalizePalletType(type: string): V010PalletType {
	const normalized = type.toLowerCase().trim();

	// Exact match for EURO-Palette (primary format from prompt)
	if (normalized === "euro-palette" || normalized === "europalette") {
		return "EURO-Palette";
	}
	// EUR-NT must come before generic EUR check
	if (normalized === "eur-nt" || normalized.includes("nicht tausch")) {
		return "EUR-NT";
	}
	// EUR/Euro pallets -> EURO-Palette (primary format)
	if (
		normalized.includes("eur") ||
		normalized.includes("euro") ||
		normalized === "ep" ||
		normalized === "356"
	) {
		return "EURO-Palette";
	}
	// Einweg pallets
	if (normalized.includes("einweg")) {
		return "Einweg-Palette";
	}
	// Düsseldorfer / half pallets
	if (
		normalized.includes("düss") ||
		normalized.includes("duss") ||
		normalized === "dd" ||
		normalized.includes("halbpal")
	) {
		return "Düsseldorfer";
	}
	// CHEP variants
	if (normalized.includes("chep-halb") || normalized.includes("chep halb")) {
		return "CHEP-HALB";
	}
	if (
		normalized.includes("chep-viertel") ||
		normalized.includes("chep viertel")
	) {
		return "CHEP-VIERTEL";
	}
	if (normalized.includes("chep")) {
		return "CHEP";
	}
	// Gitterbox
	if (normalized.includes("gitter") || normalized === "gb") {
		return "Gitterbox";
	}
	// Plastik
	if (normalized.includes("plastik") || normalized.includes("kunststoff")) {
		return "Plastik";
	}
	// H1
	if (normalized === "h1") {
		return "H1";
	}
	// Rollcontainer
	if (normalized.includes("roll")) {
		return "Rollcontainer";
	}
	// Industrie pallets
	if (normalized.includes("industrie")) {
		return "Industrie-Palette";
	}

	// Check if it's already a valid type (case-sensitive)
	if (VALID_PALLET_TYPES.includes(type as V010PalletType)) {
		return type as V010PalletType;
	}

	return "unknown";
}

function normalizeStopInfo(
	raw: RawExtractionResponse["pickup"] | RawExtractionResponse["delivery"],
): TwoPassStopInfo {
	return {
		date: raw.date || null,
		time: raw.time || null,
		location: raw.location || null,
		address: raw.address || null,
		warehouseId: raw.warehouseId || null,
		übernommen: raw.übernommen ?? 0,
		überlassen: raw.überlassen ?? 0,
	};
}

function normalizeCarrier(
	raw: RawExtractionResponse["carrier"],
): TwoPassCarrier {
	return {
		name: raw.name || null,
		licensePlate: raw.licensePlate || null,
		driverCode: raw.driverCode || null,
		driverName: raw.driverName || null,
	};
}

function normalizeReferences(
	raw: RawExtractionResponse["references"],
): TwoPassReferences {
	return {
		sendungsnummer: raw.sendungsnummer || null,
		lieferscheinNr: raw.lieferscheinNr || null,
		ladenummer: raw.ladenummer || null,
		dplVoucherNr: raw.dplVoucherNr || null,
		tourNr: raw.tourNr || null,
	};
}

function normalizeExchangeStatus(
	raw: RawExtractionResponse["exchangeStatus"],
): TwoPassExchangeStatus {
	return {
		exchanged: raw.exchanged ?? null,
		partial: raw.partial ?? false,
		comment: raw.comment || null,
		dplIssued: raw.dplIssued ?? false,
		nonExchangeReason: raw.nonExchangeReason || null,
	};
}

function normalizeExtraction(
	raw: RawExtractionResponse,
): TwoPassExtractionResult {
	return {
		pickup: normalizeStopInfo(raw.pickup),
		delivery: normalizeStopInfo(raw.delivery),
		palletType: normalizePalletType(raw.palletType),
		saldo: raw.saldo ?? 0,
		carrier: normalizeCarrier(raw.carrier),
		references: normalizeReferences(raw.references),
		exchangeStatus: normalizeExchangeStatus(raw.exchangeStatus),
		confidence: Math.max(0, Math.min(1, raw.confidence ?? 0.5)),
		notes: raw.notes || null,
	};
}

export async function extractPalletData(
	relevantPages: PDFPage[],
	classifications: PageClassification[],
	config: TwoPassConfig = DEFAULT_CONFIG,
): Promise<TwoPassExtractionResult[]> {
	if (relevantPages.length === 0) {
		throw new Error("No relevant pages to extract from");
	}

	const openrouter = createOpenRouter({
		apiKey: env.OPENROUTER_API_KEY,
	});

	const extractionModel = openrouter(config.extraction.model);

	const documentContext = buildDocumentContext(classifications);
	const prompt = buildExtractionPrompt(documentContext);

	const content: Array<
		{ type: "image"; image: string } | { type: "text"; text: string }
	> = [
		...relevantPages.map((p) => ({
			type: "image" as const,
			image: p.imageBase64,
		})),
		{ type: "text" as const, text: prompt },
	];

	const response = await withRetry(async () => {
		const result = await generateText({
			model: extractionModel,
			messages: [
				{
					role: "user",
					content,
				},
			],
		});
		return result.text;
	});

	const parsed = parseJSONResponse<
		RawExtractionResponse | RawExtractionResponse[]
	>(response);

	if (Array.isArray(parsed)) {
		return parsed.map(normalizeExtraction);
	}

	return [normalizeExtraction(parsed)];
}

export interface TwoPassExtractionPipelineResult {
	extractions: TwoPassExtractionResult[];
	success: boolean;
	error?: string;
	processingTimeMs: number;
}

export async function runExtractionPass(
	relevantPages: PDFPage[],
	classifications: PageClassification[],
	config: TwoPassConfig = DEFAULT_CONFIG,
): Promise<TwoPassExtractionPipelineResult> {
	const startTime = Date.now();

	try {
		const extractions = await extractPalletData(
			relevantPages,
			classifications,
			config,
		);

		return {
			extractions,
			success: true,
			processingTimeMs: Date.now() - startTime,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);

		return {
			extractions: [],
			success: false,
			error: errorMessage,
			processingTimeMs: Date.now() - startTime,
		};
	}
}
