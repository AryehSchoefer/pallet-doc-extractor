import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { env } from "../env.js";
import { CLASSIFICATION_PROMPT } from "../prompts/classification.js";
import type {
	ClassificationPassResult,
	PageClassification,
	PDFPage,
	TwoPassConfig,
	TwoPassDocumentType,
} from "../types/index.js";
import { parseJSONResponse, withRetry } from "./ai-client.js";
import { DEFAULT_CONFIG } from "./config.js";

interface RawClassificationResponse {
	pageNumber: number;
	isRelevant: boolean;
	documentType: string;
	confidence: number;
	keyReferences: string[];
	palletInfoFound: string | null;
	reason: string;
}

const VALID_DOCUMENT_TYPES: TwoPassDocumentType[] = [
	"ladeliste",
	"ladeschein",
	"lieferschein_with_pallets",
	"palettenschein",
	"palettennachweis",
	"dpl_gutschrift",
	"wareneingangsbeleg",
	"wareneingangsbestaetigung",
	"desadv_with_stamps",
	"speditions_auftrag",
	"palettenbewegung",
	"other_relevant",
	"lieferschein_product_only",
	"desadv_no_stamps",
	"pfand_berechnung",
	"invoice",
	"blank",
	"other_irrelevant",
	"unknown",
];

function normalizeDocumentType(type: string): TwoPassDocumentType {
	const normalized = type.toLowerCase().trim().replace(/-/g, "_");

	if (VALID_DOCUMENT_TYPES.includes(normalized as TwoPassDocumentType)) {
		return normalized as TwoPassDocumentType;
	}

	if (normalized.includes("lieferschein") && normalized.includes("pallet")) {
		return "lieferschein_with_pallets";
	}
	if (normalized.includes("lieferschein") && normalized.includes("product")) {
		return "lieferschein_product_only";
	}
	if (normalized.includes("ladeliste")) return "ladeliste";
	if (normalized.includes("ladeschein")) return "ladeschein";
	if (normalized.includes("palettenschein")) return "palettenschein";
	if (normalized.includes("palettennachweis")) return "palettennachweis";
	if (normalized.includes("palettenbewegung")) return "palettenbewegung";
	if (normalized.includes("wareneingangsbestaetigung")) {
		return "wareneingangsbestaetigung";
	}
	if (normalized.includes("wareneingang") || normalized.includes("we_beleg")) {
		return "wareneingangsbeleg";
	}
	if (normalized.includes("dpl") || normalized.includes("gutschrift")) {
		return "dpl_gutschrift";
	}
	if (normalized.includes("desadv") && normalized.includes("stamp")) {
		return "desadv_with_stamps";
	}
	if (normalized.includes("desadv")) return "desadv_no_stamps";
	if (normalized.includes("speditions")) return "speditions_auftrag";
	if (normalized.includes("pfand")) return "pfand_berechnung";
	if (normalized.includes("rechnung") || normalized.includes("invoice")) {
		return "invoice";
	}
	if (normalized === "blank" || normalized.includes("empty")) return "blank";
	if (normalized.includes("other") && normalized.includes("relevant")) {
		return "other_relevant";
	}
	if (normalized.includes("other") && normalized.includes("irrelevant")) {
		return "other_irrelevant";
	}

	return "unknown";
}

function normalizeClassification(
	raw: RawClassificationResponse,
): PageClassification {
	return {
		pageNumber: raw.pageNumber,
		isRelevant: raw.isRelevant,
		documentType: normalizeDocumentType(raw.documentType),
		confidence: Math.max(0, Math.min(1, raw.confidence)),
		keyReferences: raw.keyReferences || [],
		palletInfoFound: raw.palletInfoFound || null,
		reason: raw.reason || "",
	};
}

export async function classifyPages(
	pages: PDFPage[],
	config: TwoPassConfig = DEFAULT_CONFIG,
): Promise<ClassificationPassResult> {
	if (pages.length === 0) {
		return {
			pages: [],
			relevantPageNumbers: [],
			documentTypesFound: [],
			totalPages: 0,
			relevantPages: 0,
		};
	}

	const openrouter = createOpenRouter({
		apiKey: env.OPENROUTER_API_KEY,
	});

	const classificationModel = openrouter(config.classification.model);

	const content: Array<
		{ type: "image"; image: string } | { type: "text"; text: string }
	> = [
		...pages.map((p) => ({ type: "image" as const, image: p.imageBase64 })),
		{ type: "text" as const, text: CLASSIFICATION_PROMPT },
	];

	const response = await withRetry(async () => {
		const result = await generateText({
			model: classificationModel,
			messages: [{ role: "user", content }],
		});
		return result.text;
	});

	const rawClassifications =
		parseJSONResponse<RawClassificationResponse[]>(response);
	const classifications = rawClassifications.map(normalizeClassification);

	const pageMap = new Map<number, PageClassification>();
	for (const c of classifications) {
		pageMap.set(c.pageNumber, c);
	}

	const finalClassifications: PageClassification[] = [];
	for (let i = 0; i < pages.length; i++) {
		const pageNum = i + 1;
		const existing = pageMap.get(pageNum);
		if (existing) {
			finalClassifications.push(existing);
		} else {
			finalClassifications.push({
				pageNumber: pageNum,
				isRelevant: false,
				documentType: "unknown",
				confidence: 0.3,
				keyReferences: [],
				palletInfoFound: null,
				reason: "Page not classified by AI",
			});
		}
	}

	const relevantPageNumbers = finalClassifications
		.filter((c) => c.isRelevant)
		.map((c) => c.pageNumber);

	const documentTypesFound = [
		...new Set(
			finalClassifications
				.filter((c) => c.isRelevant)
				.map((c) => c.documentType),
		),
	];

	return {
		pages: finalClassifications,
		relevantPageNumbers,
		documentTypesFound,
		totalPages: pages.length,
		relevantPages: relevantPageNumbers.length,
	};
}

export function filterRelevantPages(
	pages: PDFPage[],
	classification: ClassificationPassResult,
): {
	relevantPages: PDFPage[];
	metadata: PageClassification[];
} {
	const relevantSet = new Set(classification.relevantPageNumbers);
	const relevantPages: PDFPage[] = [];
	const metadata: PageClassification[] = [];

	for (let i = 0; i < pages.length; i++) {
		const pageNum = i + 1;
		if (relevantSet.has(pageNum)) {
			relevantPages.push(pages[i]);
			const pageClassification = classification.pages.find(
				(p) => p.pageNumber === pageNum,
			);
			if (pageClassification) {
				metadata.push(pageClassification);
			}
		}
	}

	return { relevantPages, metadata };
}

export function buildDocumentContext(
	classifications: PageClassification[],
): string {
	if (classifications.length === 0) {
		return "No documents provided.";
	}

	const lines: string[] = ["Documents being analyzed:"];

	for (const c of classifications) {
		const refs =
			c.keyReferences.length > 0
				? ` (refs: ${c.keyReferences.join(", ")})`
				: "";
		const palletInfo = c.palletInfoFound ? ` - ${c.palletInfoFound}` : "";
		lines.push(
			`  - Page ${c.pageNumber}: ${c.documentType}${refs}${palletInfo}`,
		);
	}

	return lines.join("\n");
}
