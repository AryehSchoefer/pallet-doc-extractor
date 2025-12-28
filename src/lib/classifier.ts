import { CLASSIFICATION_PROMPT } from "../prompts/classifier.js";
import type {
	ClassificationResult,
	DocumentType,
	PDFPage,
} from "../types/index.js";
import { analyzeImage, parseJSONResponse, withRetry } from "./ai-client.js";

interface RawClassificationResponse {
	documentType: string;
	confidence: number;
	identifiers: {
		orderNumbers: string[];
		dates: string[];
		companies: string[];
	};
	reasoning?: string;
}

function normalizeDocumentType(type: string): DocumentType {
	const normalized = type.toLowerCase().trim();

	switch (normalized) {
		case "lieferschein":
			return "lieferschein";
		case "ladeliste":
		case "ladeschein":
			return "ladeliste";
		case "palettennachweis":
			return "palettennachweis";
		case "wareneingangsbeleg":
		case "wareneingang":
			return "wareneingangsbeleg";
		default:
			return "unknown";
	}
}

export async function classifyPage(
	page: PDFPage,
): Promise<ClassificationResult> {
	return withRetry(async () => {
		const response = await analyzeImage(
			page.imageBase64,
			CLASSIFICATION_PROMPT,
		);

		const parsed = parseJSONResponse<RawClassificationResponse>(response);

		return {
			documentType: normalizeDocumentType(parsed.documentType),
			confidence: Math.max(0, Math.min(1, parsed.confidence)),
			identifiers: {
				orderNumbers: parsed.identifiers?.orderNumbers || [],
				dates: parsed.identifiers?.dates || [],
				companies: parsed.identifiers?.companies || [],
			},
		};
	});
}

export async function classifyAllPages(
	pages: PDFPage[],
): Promise<Map<number, ClassificationResult>> {
	const results = new Map<number, ClassificationResult>();

	const concurrencyLimit = 3;
	const chunks: PDFPage[][] = [];

	for (let i = 0; i < pages.length; i += concurrencyLimit) {
		chunks.push(pages.slice(i, i + concurrencyLimit));
	}

	for (const chunk of chunks) {
		const chunkResults = await Promise.all(
			chunk.map(async (page) => {
				try {
					const result = await classifyPage(page);
					return { pageNumber: page.pageNumber, result };
				} catch (error) {
					console.error(`Failed to classify page ${page.pageNumber}:`, error);
					return {
						pageNumber: page.pageNumber,
						result: {
							documentType: "unknown" as DocumentType,
							confidence: 0,
							identifiers: { orderNumbers: [], dates: [], companies: [] },
						},
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

export function groupPagesByDelivery(
	classifications: Map<number, ClassificationResult>,
): Map<string, number[]> {
	const groups = new Map<string, number[]>();
	const orderToPages = new Map<string, Set<number>>();

	for (const [pageNum, result] of classifications) {
		for (const orderNum of result.identifiers.orderNumbers) {
			if (!orderToPages.has(orderNum)) {
				orderToPages.set(orderNum, new Set());
			}
			orderToPages.get(orderNum)?.add(pageNum);
		}
	}

	let groupIndex = 0;
	const assignedPages = new Set<number>();

	for (const [orderNum, pages] of orderToPages) {
		const groupKey = `delivery_${groupIndex++}_${orderNum}`;
		groups.set(
			groupKey,
			Array.from(pages).sort((a, b) => a - b),
		);
		pages.forEach((p) => {
			assignedPages.add(p);
		});
	}

	const unassignedPages: number[] = [];
	for (const pageNum of classifications.keys()) {
		if (!assignedPages.has(pageNum)) {
			unassignedPages.push(pageNum);
		}
	}

	if (unassignedPages.length > 0) {
		groups.set(
			"unassigned",
			unassignedPages.sort((a, b) => a - b),
		);
	}

	return groups;
}
