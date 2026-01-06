import type {
	TwoPassConfig,
	TwoPassExtractionResult,
	ValidationResult,
} from "../types/index.js";
import { DEFAULT_CONFIG } from "./config.js";

export function validateExtraction(
	extraction: TwoPassExtractionResult,
	config: TwoPassConfig = DEFAULT_CONFIG,
): ValidationResult {
	const result = JSON.parse(
		JSON.stringify(extraction),
	) as TwoPassExtractionResult;
	const errors: string[] = [];
	const warnings: string[] = [];
	let corrected = false;

	// 1. Validate and correct saldo calculation
	const expectedSaldo = result.delivery.übernommen - result.delivery.überlassen;
	if (result.saldo !== expectedSaldo) {
		errors.push(
			`Saldo mismatch: expected ${expectedSaldo} (übernommen ${result.delivery.übernommen} - überlassen ${result.delivery.überlassen}), got ${result.saldo}`,
		);
		if (config.validation.autoCorrectSaldo) {
			result.saldo = expectedSaldo;
			corrected = true;
		}
	}

	// 2. Validate exchange consistency
	// If marked as not exchanged but übernommen > 0, that's inconsistent
	if (
		result.exchangeStatus.exchanged === false &&
		result.delivery.übernommen > 0
	) {
		errors.push(
			`Inconsistent: marked as not exchanged but übernommen = ${result.delivery.übernommen} at delivery`,
		);
		if (config.validation.autoCorrectExchangeStatus) {
			// If übernommen > 0, it was actually exchanged (at least partially)
			if (result.delivery.übernommen === result.delivery.überlassen) {
				result.exchangeStatus.exchanged = true;
			} else {
				result.exchangeStatus.partial = true;
			}
			corrected = true;
		}
	}

	// 3. Validate delivery matches pickup (warning only)
	// The pallets delivered should match what was picked up
	if (result.delivery.überlassen !== result.pickup.übernommen) {
		warnings.push(
			`überlassen at delivery (${result.delivery.überlassen}) doesn't match übernommen at pickup (${result.pickup.übernommen})`,
		);
	}

	// 4. Validate DPL consistency
	// If DPL issued, should not be marked as fully exchanged
	if (
		result.exchangeStatus.dplIssued &&
		result.exchangeStatus.exchanged === true
	) {
		errors.push("DPL voucher issued but marked as fully exchanged");
		if (config.validation.autoCorrectExchangeStatus) {
			result.exchangeStatus.exchanged = false;
			corrected = true;
		}
	}

	// 5. If dplIssued but no voucher number, add warning
	if (result.exchangeStatus.dplIssued && !result.references.dplVoucherNr) {
		warnings.push("DPL marked as issued but no voucher number provided");
	}

	// 6. Check for missing key data
	if (!result.pickup.date && !result.delivery.date) {
		warnings.push("No date found for pickup or delivery");
	}

	if (!result.pickup.location && !result.delivery.location) {
		warnings.push("No location found for pickup or delivery");
	}

	if (!result.carrier.name && !result.carrier.licensePlate) {
		warnings.push("No carrier identification (name or license plate)");
	}

	// 7. Check for zero movements
	if (
		result.pickup.übernommen === 0 &&
		result.pickup.überlassen === 0 &&
		result.delivery.übernommen === 0 &&
		result.delivery.überlassen === 0
	) {
		warnings.push("No pallet movements detected");
	}

	// 8. Check for negative quantities (invalid)
	if (
		result.pickup.übernommen < 0 ||
		result.pickup.überlassen < 0 ||
		result.delivery.übernommen < 0 ||
		result.delivery.überlassen < 0
	) {
		errors.push("Negative pallet quantities detected");
	}

	// 9. Check for unknown pallet type
	if (result.palletType === "unknown") {
		warnings.push("Pallet type is unknown");
	}

	// 10. Check for exchange status clarity
	if (result.exchangeStatus.exchanged === null) {
		warnings.push("Exchange status is unclear (null)");
	}

	return {
		result,
		errors,
		warnings,
		corrected,
		isValid: errors.length === 0,
	};
}

export function needsReview(
	extraction: TwoPassExtractionResult,
	validation: ValidationResult,
	config: TwoPassConfig = DEFAULT_CONFIG,
): { needsReview: boolean; reasons: string[] } {
	const reasons: string[] = [];

	// Low confidence
	if (
		config.validation.flagLowConfidence &&
		extraction.confidence < config.validation.lowConfidenceThreshold
	) {
		reasons.push(
			`Low extraction confidence: ${(extraction.confidence * 100).toFixed(1)}%`,
		);
	}

	// Validation errors (even if corrected)
	if (validation.errors.length > 0) {
		reasons.push(
			`Validation errors detected: ${validation.errors.length} error(s)`,
		);
	}

	// Too many warnings
	if (validation.warnings.length > 2) {
		reasons.push(`Multiple warnings: ${validation.warnings.length} warning(s)`);
	}

	// No pallet movements
	if (
		extraction.pickup.übernommen === 0 &&
		extraction.delivery.überlassen === 0
	) {
		reasons.push("No pallet movements extracted");
	}

	return {
		needsReview: reasons.length > 0,
		reasons,
	};
}

export function validateExtractions(
	extractions: TwoPassExtractionResult[],
	config: TwoPassConfig = DEFAULT_CONFIG,
): ValidationResult[] {
	return extractions.map((e) => validateExtraction(e, config));
}
