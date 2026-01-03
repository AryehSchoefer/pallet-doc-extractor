import type {
	GroupExtractionResult,
	V010ExtractionData,
	V010PalletMovement,
} from "../types/index.js";

export function calculateSaldo(extraction: V010ExtractionData): number {
	const sumQty = (movements: V010PalletMovement[]): number =>
		movements.reduce((sum, m) => sum + m.qty, 0);

	const given = sumQty(extraction.palletsGiven);
	const received = sumQty(extraction.palletsReceived);

	return given - received;
}

export function calculateSaldoByType(
	extraction: V010ExtractionData,
): Map<string, number> {
	const saldoByType = new Map<string, number>();

	for (const movement of extraction.palletsGiven) {
		const current = saldoByType.get(movement.type) ?? 0;
		saldoByType.set(movement.type, current + movement.qty);
	}

	for (const movement of extraction.palletsReceived) {
		const current = saldoByType.get(movement.type) ?? 0;
		saldoByType.set(movement.type, current - movement.qty);
	}

	return saldoByType;
}

function validateExtraction(extraction: V010ExtractionData): string[] {
	const warnings: string[] = [];

	if (!extraction.date) {
		warnings.push("Missing date");
	}

	if (!extraction.location.name && !extraction.location.address) {
		warnings.push("Missing location information");
	}

	if (!extraction.carrier.name && !extraction.carrier.licensePlate) {
		warnings.push("Missing carrier identification");
	}

	if (
		extraction.palletsGiven.length === 0 &&
		extraction.palletsReceived.length === 0
	) {
		warnings.push("No pallet movements found");
	}

	if (extraction.exchanged === null) {
		warnings.push("Exchange status unclear");
	}

	// Check for inconsistencies
	if (
		extraction.exchanged === true &&
		extraction.palletsReceived.length === 0
	) {
		warnings.push("Marked as exchanged but no pallets received");
	}

	if (extraction.exchanged === false && extraction.palletsReceived.length > 0) {
		warnings.push("Marked as not exchanged but pallets received");
	}

	if (extraction.dplIssued && !extraction.dplVoucherNumber) {
		warnings.push("DPL issued but no voucher number");
	}

	return warnings;
}

function enrichExtraction(extraction: V010ExtractionData): V010ExtractionData {
	const calculatedSaldo = calculateSaldo(extraction);

	return {
		...extraction,
		saldo: extraction.saldo ?? calculatedSaldo,
	};
}

function processExtraction(extraction: V010ExtractionData): {
	data: V010ExtractionData;
	warnings: string[];
	needsReview: boolean;
} {
	const warnings = validateExtraction(extraction);
	const enriched = enrichExtraction(extraction);

	const needsReview =
		enriched.confidence < 0.7 ||
		warnings.length > 2 ||
		(enriched.palletsGiven.length === 0 &&
			enriched.palletsReceived.length === 0);

	return {
		data: enriched,
		warnings,
		needsReview,
	};
}

/**
 * Validate and enrich extraction result.
 * Adds calculated saldo, validates data, flags items needing review.
 */
export function validateAndEnrich(
	result: GroupExtractionResult,
): GroupExtractionResult {
	if (!result.success || !result.data) {
		return result;
	}

	if (Array.isArray(result.data)) {
		const processedItems = result.data.map(processExtraction);
		const anyNeedsReview = processedItems.some((p) => p.needsReview);

		return {
			...result,
			data: processedItems.map((p) => p.data),
			needsReview: result.needsReview || anyNeedsReview,
		};
	}

	const processed = processExtraction(result.data);

	return {
		...result,
		data: processed.data,
		needsReview: result.needsReview || processed.needsReview,
	};
}

/**
 * Merge multiple extractions from the same document group.
 * Used when multiple transactions should be combined.
 */
export function mergeExtractions(
	extractions: V010ExtractionData[],
): V010ExtractionData {
	if (extractions.length === 0) {
		throw new Error("Cannot merge empty extractions array");
	}

	if (extractions.length === 1) {
		return extractions[0];
	}

	const base = extractions[0];
	const allGiven: V010PalletMovement[] = [];
	const allReceived: V010PalletMovement[] = [];
	const allReturned: V010PalletMovement[] = [];
	const allReferences: string[] = [];
	const allSubtypes = new Set<string>();
	let lowestConfidence = 1;

	for (const ext of extractions) {
		allGiven.push(...ext.palletsGiven);
		allReceived.push(...ext.palletsReceived);
		allReturned.push(...ext.palletsReturned);
		allReferences.push(...ext.references);
		for (const s of ext.documentSubtypes) {
			allSubtypes.add(s);
		}
		lowestConfidence = Math.min(lowestConfidence, ext.confidence);
	}

	return {
		...base,
		documentType: "mixed",
		documentSubtypes: Array.from(
			allSubtypes,
		) as V010ExtractionData["documentSubtypes"],
		palletsGiven: consolidatePalletMovements(allGiven),
		palletsReceived: consolidatePalletMovements(allReceived),
		palletsReturned: consolidatePalletMovements(allReturned),
		references: [...new Set(allReferences)],
		confidence: lowestConfidence,
		extractionNotes: `Merged from ${extractions.length} extractions`,
	};
}

function consolidatePalletMovements(
	movements: V010PalletMovement[],
): V010PalletMovement[] {
	const byType = new Map<string, V010PalletMovement>();

	for (const movement of movements) {
		const existing = byType.get(movement.type);
		if (existing) {
			existing.qty += movement.qty;
			if (movement.damaged) {
				existing.damaged = (existing.damaged ?? 0) + movement.damaged;
			}
		} else {
			byType.set(movement.type, { ...movement });
		}
	}

	return Array.from(byType.values());
}
