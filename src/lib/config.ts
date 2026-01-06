import type { TwoPassConfig } from "../types/index.js";

/**
 * Default configuration for two-pass extraction.
 */
export const DEFAULT_CONFIG: TwoPassConfig = {
	classification: {
		// Use a fast, cheap model for classification (or not)
		// model: "google/gemini-2.0-flash-001",
		model: "google/gemini-2.5-pro",
		temperature: 0,
		maxTokens: 2048,
		// Pages with confidence below this are flagged for review
		confidenceThreshold: 0.6,
	},
	extraction: {
		// Use a smarter model for extraction
		model: "google/gemini-2.5-pro",
		temperature: 0,
		maxTokens: 4096,
	},
	validation: {
		// Auto-correct saldo if math is wrong
		autoCorrectSaldo: true,
		// Auto-correct exchange status inconsistencies
		autoCorrectExchangeStatus: true,
		// Flag extractions with low confidence
		flagLowConfidence: true,
		// Threshold below which extraction is flagged for review
		lowConfidenceThreshold: 0.7,
	},
	output: {
		// Save classification results for debugging
		saveClassifications: true,
		// Save raw extraction before transformation
		saveRawExtraction: true,
		// Output directory
		outputDir: "./output",
	},
};

export function getConfig(overrides?: Partial<TwoPassConfig>): TwoPassConfig {
	if (!overrides) {
		return DEFAULT_CONFIG;
	}

	return {
		classification: {
			...DEFAULT_CONFIG.classification,
			...overrides.classification,
		},
		extraction: {
			...DEFAULT_CONFIG.extraction,
			...overrides.extraction,
		},
		validation: {
			...DEFAULT_CONFIG.validation,
			...overrides.validation,
		},
		output: {
			...DEFAULT_CONFIG.output,
			...overrides.output,
		},
	};
}

/**
 * Environment variable overrides for config.
 * These take precedence over defaults.
 */
export function getConfigFromEnv(): Partial<TwoPassConfig> {
	const overrides: Partial<TwoPassConfig> = {};

	if (process.env.CLASSIFICATION_MODEL) {
		overrides.classification = {
			...DEFAULT_CONFIG.classification,
			model: process.env.CLASSIFICATION_MODEL,
		};
	}

	if (process.env.EXTRACTION_MODEL) {
		overrides.extraction = {
			...DEFAULT_CONFIG.extraction,
			model: process.env.EXTRACTION_MODEL,
		};
	}

	if (process.env.OUTPUT_DIR) {
		overrides.output = {
			...DEFAULT_CONFIG.output,
			outputDir: process.env.OUTPUT_DIR,
		};
	}

	return overrides;
}
