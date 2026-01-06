import type {
	TwoPassConfig,
	TwoPassExtractionResult,
	TwoPassLademittelmahnungOutput,
	TwoPassPalletMovement,
	ValidationResult,
} from "../types/index.js";
import { DEFAULT_CONFIG } from "./config.js";
import { needsReview } from "./validation.js";

export function transformToLademittelmahnung(
	extraction: TwoPassExtractionResult,
	validation?: ValidationResult,
	config: TwoPassConfig = DEFAULT_CONFIG,
): TwoPassLademittelmahnungOutput {
	const referenceNumber =
		extraction.references.sendungsnummer ||
		extraction.references.lieferscheinNr ||
		extraction.references.ladenummer ||
		extraction.references.tourNr ||
		"UNKNOWN";

	const palletMovement: TwoPassPalletMovement = {
		palletType: extraction.palletType,
		beladestelle: {
			übernommen: extraction.pickup.übernommen,
			überlassen: extraction.pickup.überlassen,
		},
		entladestelle: {
			überlassen: extraction.delivery.überlassen,
			übernommen: extraction.delivery.übernommen,
		},
		saldo: extraction.saldo,
	};

	const reviewCheck = validation
		? needsReview(extraction, validation, config)
		: { needsReview: false, reasons: [] };

	return {
		referenceNumber,
		pickup: {
			date: extraction.pickup.date || "N/A",
			time: extraction.pickup.time,
			location: extraction.pickup.location || "N/A",
			address: extraction.pickup.address || "N/A",
		},
		delivery: {
			date: extraction.delivery.date || "N/A",
			time: extraction.delivery.time,
			location: extraction.delivery.location || "N/A",
			address: extraction.delivery.address || "N/A",
		},
		palletMovements: [palletMovement],
		carrier: extraction.carrier,
		exchangeStatus: extraction.exchangeStatus,
		dplVoucherNr: extraction.references.dplVoucherNr,
		confidence: extraction.confidence,
		notes: extraction.notes,
		needsReview: reviewCheck.needsReview,
		reviewReasons: reviewCheck.reasons,
	};
}

export function transformMultipleToLademittelmahnung(
	extractions: TwoPassExtractionResult[],
	validations?: ValidationResult[],
	config: TwoPassConfig = DEFAULT_CONFIG,
): TwoPassLademittelmahnungOutput[] {
	if (extractions.length === 0) {
		return [];
	}

	const byReference = new Map<
		string,
		{
			extractions: TwoPassExtractionResult[];
			validations: (ValidationResult | undefined)[];
		}
	>();

	for (let i = 0; i < extractions.length; i++) {
		const extraction = extractions[i];
		const validation = validations?.[i];

		const refKey =
			extraction.references.sendungsnummer ||
			extraction.references.lieferscheinNr ||
			extraction.references.ladenummer ||
			"_default";

		let group = byReference.get(refKey);
		if (!group) {
			group = { extractions: [], validations: [] };
			byReference.set(refKey, group);
		}

		group.extractions.push(extraction);
		group.validations.push(validation);
	}

	const results: TwoPassLademittelmahnungOutput[] = [];

	for (const [_, group] of byReference) {
		if (group.extractions.length === 1) {
			// Single extraction for this reference
			results.push(
				transformToLademittelmahnung(
					group.extractions[0],
					group.validations[0],
					config,
				),
			);
		} else {
			// Multiple extractions (different pallet types) - merge
			const merged = mergeExtractions(
				group.extractions,
				group.validations,
				config,
			);
			results.push(merged);
		}
	}

	return results;
}

function mergeExtractions(
	extractions: TwoPassExtractionResult[],
	validations: (ValidationResult | undefined)[],
	config: TwoPassConfig,
): TwoPassLademittelmahnungOutput {
	const base = extractions[0];

	const palletMovements: TwoPassPalletMovement[] = extractions.map((e) => ({
		palletType: e.palletType,
		beladestelle: {
			übernommen: e.pickup.übernommen,
			überlassen: e.pickup.überlassen,
		},
		entladestelle: {
			überlassen: e.delivery.überlassen,
			übernommen: e.delivery.übernommen,
		},
		saldo: e.saldo,
	}));

	const lowestConfidence = Math.min(...extractions.map((e) => e.confidence));

	const allReviewReasons: string[] = [];
	let anyNeedsReview = false;

	for (let i = 0; i < extractions.length; i++) {
		const validation = validations[i];
		if (validation) {
			const reviewCheck = needsReview(extractions[i], validation, config);
			if (reviewCheck.needsReview) {
				anyNeedsReview = true;
				allReviewReasons.push(...reviewCheck.reasons);
			}
		}
	}

	const referenceNumber =
		base.references.sendungsnummer ||
		base.references.lieferscheinNr ||
		base.references.ladenummer ||
		base.references.tourNr ||
		"UNKNOWN";

	return {
		referenceNumber,
		pickup: {
			date: base.pickup.date || "N/A",
			time: base.pickup.time,
			location: base.pickup.location || "N/A",
			address: base.pickup.address || "N/A",
		},
		delivery: {
			date: base.delivery.date || "N/A",
			time: base.delivery.time,
			location: base.delivery.location || "N/A",
			address: base.delivery.address || "N/A",
		},
		palletMovements,
		carrier: base.carrier,
		exchangeStatus: base.exchangeStatus,
		dplVoucherNr: base.references.dplVoucherNr,
		confidence: lowestConfidence,
		notes:
			extractions
				.map((e) => e.notes)
				.filter(Boolean)
				.join("; ") || null,
		needsReview: anyNeedsReview,
		reviewReasons: [...new Set(allReviewReasons)],
	};
}

export function calculateTotalSaldo(
	output: TwoPassLademittelmahnungOutput,
): number {
	return output.palletMovements.reduce((sum, m) => sum + m.saldo, 0);
}

export function calculateSaldoByType(
	output: TwoPassLademittelmahnungOutput,
): Map<string, number> {
	const saldoByType = new Map<string, number>();

	for (const movement of output.palletMovements) {
		const current = saldoByType.get(movement.palletType) || 0;
		saldoByType.set(movement.palletType, current + movement.saldo);
	}

	return saldoByType;
}
