#!/usr/bin/env node
import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { classifyPages, filterRelevantPages } from "./lib/classifier.js";
import { getConfig, getConfigFromEnv } from "./lib/config.js";
import { runExtractionPass } from "./lib/extractor-twopass.js";
import { saveAsJSON } from "./lib/output-generator.js";
import { processPDF } from "./lib/pdf-processor.js";
import { transformToLademittelmahnung } from "./lib/transform.js";
import { validateExtraction } from "./lib/validation.js";
import type {
	TwoPassLademittelmahnungOutput,
	TwoPassProcessingResult,
} from "./types/index.js";

function parseArgs(): { input: string; output: string } {
	const args = process.argv.slice(2);
	let input = "";
	let output = "";

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--input" || args[i] === "-i") {
			input = args[i + 1] || "";
			i++;
		} else if (args[i] === "--output" || args[i] === "-o") {
			output = args[i + 1] || "";
			i++;
		}
	}

	if (!input) {
		console.error(
			"Usage: pnpm extract -- --input <pdf-file> [--output <json-file>]",
		);
		process.exit(1);
	}

	if (!output) {
		const basename = path.basename(input, ".pdf");
		output = path.join("./output", `${basename}_result.json`);
	}

	return { input, output };
}

async function main(): Promise<void> {
	const startTime = Date.now();

	if (!process.env.OPENROUTER_API_KEY) {
		console.error("Error: OPENROUTER_API_KEY environment variable is not set");
		console.error(
			"Please create a .env file with your API key or set it in your environment",
		);
		process.exit(1);
	}

	const { input, output } = parseArgs();
	const basename = path.basename(input, ".pdf");

	const timestamp = Date.now();
	const outputDir = path.join(path.dirname(output), String(timestamp));
	const outputFile = path.join(outputDir, path.basename(output));

	await fs.mkdir(outputDir, { recursive: true });

	const config = getConfig(getConfigFromEnv());

	console.log(`\n=== Two-Pass Pallet Extraction ===`);
	console.log(`Input:  ${input}`);
	console.log(`Output: ${outputDir}/`);
	console.log();

	const result: TwoPassProcessingResult = {
		classification: {
			pages: [],
			relevantPageNumbers: [],
			documentTypesFound: [],
			totalPages: 0,
			relevantPages: 0,
		},
		extractions: [],
		lademittelmahnung: [],
		processingTimeMs: 0,
		success: false,
	};

	try {
		// Step 1: Process PDF to images
		console.log("Step 1: Processing PDF...");
		const pdfResult = await processPDF(input);
		console.log(`  Total pages: ${pdfResult.totalPages}`);

		// Step 2: Classification pass
		console.log("\nStep 2: Classifying pages...");
		const classification = await classifyPages(pdfResult.pages, config);
		result.classification = classification;

		console.log(
			`  Relevant pages: ${classification.relevantPages}/${classification.totalPages}`,
		);

		for (const pageClass of classification.pages) {
			const status = pageClass.isRelevant ? "✓" : "✗";
			console.log(
				`    Page ${pageClass.pageNumber}: ${status} ${pageClass.documentType} (${(pageClass.confidence * 100).toFixed(0)}%)`,
			);
		}

		// Step 3: Filter to relevant pages
		if (classification.relevantPages === 0) {
			console.log("\n⚠️  No pallet-relevant documents found");
			result.error = "No pallet-relevant documents found in PDF";

			if (config.output.saveClassifications) {
				const classificationPath = outputFile.replace(
					".json",
					"_classification.json",
				);
				await saveAsJSON(classification, classificationPath);
			}

			console.log(`\nClassification saved to: ${outputDir}/`);
			process.exit(0);
		}

		const { relevantPages, metadata } = filterRelevantPages(
			pdfResult.pages,
			classification,
		);

		// Step 4: Extraction pass
		console.log("\nStep 3: Extracting pallet data...");
		const extractionResult = await runExtractionPass(
			relevantPages,
			metadata,
			config,
		);

		if (!extractionResult.success) {
			throw new Error(extractionResult.error || "Extraction failed");
		}

		result.extractions = extractionResult.extractions;

		// Step 5: Validate
		console.log("\nStep 4: Validating...");
		const validations = result.extractions.map((e) =>
			validateExtraction(e, config),
		);

		for (const validation of validations) {
			if (validation.errors.length > 0) {
				console.warn(
					"  Validation errors (auto-corrected):",
					validation.errors,
				);
			}
			if (validation.warnings.length > 0) {
				console.warn("  Warnings:", validation.warnings);
			}
		}

		const validatedExtractions = validations.map((v) => v.result);

		// Step 6: Transform to output format
		console.log("\nStep 5: Generating Lademittelmahnung...");
		const lademittelmahnungResults: TwoPassLademittelmahnungOutput[] = [];

		for (let i = 0; i < validatedExtractions.length; i++) {
			const lmOutput = transformToLademittelmahnung(
				validatedExtractions[i],
				validations[i],
				config,
			);
			lademittelmahnungResults.push(lmOutput);
		}

		result.lademittelmahnung = lademittelmahnungResults;
		result.success = true;
		result.processingTimeMs = Date.now() - startTime;

		// Step 7: Save results
		console.log("\nStep 6: Saving results...");

		// Save classification
		if (config.output.saveClassifications) {
			const classificationPath = outputFile.replace(
				".json",
				"_classification.json",
			);
			await saveAsJSON(classification, classificationPath);
		}

		// Save raw extraction
		if (config.output.saveRawExtraction) {
			const extractionPath = outputFile.replace(".json", "_extraction.json");
			await saveAsJSON(validatedExtractions, extractionPath);
		}

		// Save Lademittelmahnung output
		if (lademittelmahnungResults.length > 0) {
			await saveAsJSON(lademittelmahnungResults, outputFile);
		}

		const duration = ((Date.now() - startTime) / 1000).toFixed(2);
		console.log(`\n=== Extraction Complete ===`);
		console.log(`Duration: ${duration}s`);
		console.log(`Extractions: ${validatedExtractions.length}`);

		const needsReviewCount = lademittelmahnungResults.filter(
			(r) => r.needsReview,
		).length;
		if (needsReviewCount > 0) {
			console.log(
				`\n⚠️  ${needsReviewCount} extraction(s) flagged for manual review`,
			);
		}

		for (const extraction of validatedExtractions) {
			console.log(`\nPallet Type: ${extraction.palletType}`);
			console.log(`  Pickup: ${extraction.pickup.location || "Unknown"}`);
			console.log(`    Date: ${extraction.pickup.date || "Unknown"}`);
			console.log(`    übernommen: ${extraction.pickup.übernommen}`);
			console.log(`  Delivery: ${extraction.delivery.location || "Unknown"}`);
			console.log(`    Date: ${extraction.delivery.date || "Unknown"}`);
			console.log(`    überlassen: ${extraction.delivery.überlassen}`);
			console.log(`    übernommen: ${extraction.delivery.übernommen}`);
			console.log(
				`  Exchanged: ${extraction.exchangeStatus.exchanged ?? "Unknown"}`,
			);
			console.log(`  Saldo: ${extraction.saldo}`);
			console.log(`  Confidence: ${(extraction.confidence * 100).toFixed(1)}%`);
		}

		console.log(`\nResults saved to: ${outputDir}/`);
	} catch (error) {
		console.error("\nError during extraction:", error);
		result.error = error instanceof Error ? error.message : String(error);
		result.success = false;
		result.processingTimeMs = Date.now() - startTime;

		const errorPath = path.join(outputDir, `${basename}_error.json`);
		await saveAsJSON(
			{
				error: result.error,
				classification: result.classification,
				timestamp: new Date().toISOString(),
			},
			errorPath,
		);

		process.exit(1);
	}
}

main();
