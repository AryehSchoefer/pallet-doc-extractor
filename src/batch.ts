#!/usr/bin/env node
import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { classifyPages, filterRelevantPages } from "./lib/classifier.js";
import { getConfig, getConfigFromEnv } from "./lib/config.js";
import {
	groupFilesByPrefix,
	processDocumentGroup,
} from "./lib/document-grouper.js";
import { runExtractionPass } from "./lib/extractor-twopass.js";
import { generateExcel, saveAsJSON } from "./lib/output-generator.js";
import { transformMultipleToLademittelmahnung } from "./lib/transform.js";
import { validateExtraction } from "./lib/validation.js";
import type {
	ClassificationPassResult,
	TwoPassConfig,
	TwoPassExtractionResult,
	TwoPassLademittelmahnungOutput,
} from "./types/index.js";

interface TwoPassBatchProcessingResult {
	groupPrefix: string;
	inputFiles: string[];
	success: boolean;
	classification?: ClassificationPassResult;
	extractions?: TwoPassExtractionResult[];
	lademittelmahnung?: TwoPassLademittelmahnungOutput[];
	error?: string;
	processingTimeMs: number;
	needsReview: boolean;
}

interface TwoPassBatchSummary {
	totalGroups: number;
	totalFiles: number;
	successCount: number;
	failureCount: number;
	needsReviewCount: number;
	results: TwoPassBatchProcessingResult[];
}

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
			"Usage: pnpm extract:batch -- --input <directory> [--output <directory>]",
		);
		process.exit(1);
	}

	if (!output) {
		output = "./output";
	}

	return { input, output };
}

async function findPDFFiles(dirPath: string): Promise<string[]> {
	const absolutePath = path.resolve(dirPath);
	const entries = await fs.readdir(absolutePath, { withFileTypes: true });

	const pdfFiles: string[] = [];
	for (const entry of entries) {
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
			pdfFiles.push(path.join(absolutePath, entry.name));
		}
	}

	return pdfFiles.sort();
}

async function processGroup(
	prefix: string,
	files: string[],
	outputDir: string,
	config: TwoPassConfig,
): Promise<TwoPassBatchProcessingResult> {
	const startTime = Date.now();

	try {
		console.log(`\nProcessing group: ${prefix} (${files.length} file(s))`);
		for (const file of files) {
			console.log(`  - ${path.basename(file)}`);
		}

		// Step 1: Process PDFs to images
		const group = await processDocumentGroup(prefix, files);
		console.log(`  Total pages: ${group.pages.length}`);

		// Step 2: Classification pass
		console.log(`  Classifying pages...`);
		const classification = await classifyPages(group.pages, config);

		console.log(
			`  Relevant: ${classification.relevantPages}/${classification.totalPages} pages`,
		);

		// Log classifications briefly
		for (const pageClass of classification.pages) {
			const status = pageClass.isRelevant ? "✓" : "✗";
			console.log(
				`    Page ${pageClass.pageNumber}: ${status} ${pageClass.documentType}`,
			);
		}

		// Check for no relevant pages
		if (classification.relevantPages === 0) {
			const duration = Date.now() - startTime;
			console.log(`  No pallet-relevant documents found`);

			// Save classification for debugging
			if (config.output.saveClassifications) {
				const classificationPath = path.join(
					outputDir,
					`${prefix}_classification.json`,
				);
				await saveAsJSON(classification, classificationPath);
			}

			return {
				groupPrefix: prefix,
				inputFiles: files,
				success: true,
				classification,
				extractions: [],
				lademittelmahnung: [],
				processingTimeMs: duration,
				needsReview: false,
			};
		}

		// Step 3: Filter to relevant pages
		const { relevantPages, metadata } = filterRelevantPages(
			group.pages,
			classification,
		);

		// Step 4: Extraction pass
		console.log(`  Extracting pallet data...`);
		const extractionResult = await runExtractionPass(
			relevantPages,
			metadata,
			config,
		);

		if (!extractionResult.success) {
			throw new Error(extractionResult.error || "Extraction failed");
		}

		// Step 5: Validate
		const validations = extractionResult.extractions.map((e) =>
			validateExtraction(e, config),
		);

		// Use validated extractions
		const validatedExtractions = validations.map((v) => v.result);

		// Step 6: Transform to output format
		const lademittelmahnungResults = transformMultipleToLademittelmahnung(
			validatedExtractions,
			validations,
			config,
		);

		// Save results
		if (config.output.saveClassifications) {
			const classificationPath = path.join(
				outputDir,
				`${prefix}_classification.json`,
			);
			await saveAsJSON(classification, classificationPath);
		}

		if (config.output.saveRawExtraction) {
			const extractionPath = path.join(outputDir, `${prefix}_extraction.json`);
			await saveAsJSON(validatedExtractions, extractionPath);
		}

		if (lademittelmahnungResults.length > 0) {
			const resultPath = path.join(outputDir, `${prefix}_result.json`);
			await saveAsJSON(lademittelmahnungResults, resultPath);
		}

		const duration = Date.now() - startTime;
		const avgConfidence =
			validatedExtractions.length > 0
				? validatedExtractions.reduce((sum, e) => sum + e.confidence, 0) /
					validatedExtractions.length
				: 0;

		const needsReview = lademittelmahnungResults.some((r) => r.needsReview);

		console.log(
			`  Complete (${(duration / 1000).toFixed(2)}s) - Confidence: ${(avgConfidence * 100).toFixed(1)}%`,
		);

		if (needsReview) {
			console.log(`  NOTE: Flagged for review`);
		}

		return {
			groupPrefix: prefix,
			inputFiles: files,
			success: true,
			classification,
			extractions: validatedExtractions,
			lademittelmahnung: lademittelmahnungResults,
			processingTimeMs: duration,
			needsReview,
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`  Error: ${errorMessage}`);

		return {
			groupPrefix: prefix,
			inputFiles: files,
			success: false,
			error: errorMessage,
			processingTimeMs: duration,
			needsReview: true,
		};
	}
}

/**
 * Convert TwoPassLademittelmahnungOutput to the format expected by generateExcel.
 * This bridges the two-pass output to the legacy Excel generation.
 */
function convertToLegacyFormat(
	results: TwoPassLademittelmahnungOutput[],
): Array<{
	referenceNumber: string;
	pickup: { date: string; time?: string; location: string; address: string };
	delivery: { date: string; time?: string; location: string; address: string };
	palletMovements: Array<{
		palletType: string;
		pickupReceived: number;
		pickupGiven: number;
		deliveryGiven: number;
		deliveryReceived: number;
		saldo: number;
	}>;
}> {
	return results.map((r) => ({
		referenceNumber: r.referenceNumber,
		pickup: {
			date: r.pickup.date,
			time: r.pickup.time || undefined,
			location: r.pickup.location,
			address: r.pickup.address,
		},
		delivery: {
			date: r.delivery.date,
			time: r.delivery.time || undefined,
			location: r.delivery.location,
			address: r.delivery.address,
		},
		palletMovements: r.palletMovements.map((m) => ({
			palletType: m.palletType,
			pickupReceived: m.beladestelle.übernommen,
			pickupGiven: m.beladestelle.überlassen,
			deliveryGiven: m.entladestelle.überlassen,
			deliveryReceived: m.entladestelle.übernommen,
			saldo: m.saldo,
		})),
	}));
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
	const config = getConfig(getConfigFromEnv());

	const timestamp = Date.now();
	const outputDir = path.join(output, String(timestamp));

	console.log(`\n=== Two-Pass Batch Pallet Movement Extraction ===`);
	console.log(`Input directory:  ${input}`);
	console.log(`Output directory: ${outputDir}/`);
	console.log(`Classification model: ${config.classification.model}`);
	console.log(`Extraction model: ${config.extraction.model}`);

	const pdfFiles = await findPDFFiles(input);

	if (pdfFiles.length === 0) {
		console.error(`\nNo PDF files found in ${input}`);
		process.exit(1);
	}

	console.log(`\nFound ${pdfFiles.length} PDF file(s)`);

	const fileGroups = groupFilesByPrefix(pdfFiles);
	console.log(`Grouped into ${fileGroups.size} document group(s)`);

	await fs.mkdir(outputDir, { recursive: true });

	const results: TwoPassBatchProcessingResult[] = [];
	const allLademittelmahnungResults: TwoPassLademittelmahnungOutput[] = [];

	for (const [prefix, files] of fileGroups) {
		const result = await processGroup(prefix, files, outputDir, config);
		results.push(result);

		if (result.lademittelmahnung) {
			allLademittelmahnungResults.push(...result.lademittelmahnung);
		}
	}

	// Generate Excel if we have results
	if (allLademittelmahnungResults.length > 0) {
		console.log("\nGenerating combined Excel file...");
		const excelPath = path.join(outputDir, "combined_results.xlsx");
		const legacyFormat = convertToLegacyFormat(allLademittelmahnungResults);
		await generateExcel(legacyFormat, excelPath);
	}

	const summary: TwoPassBatchSummary = {
		totalGroups: fileGroups.size,
		totalFiles: pdfFiles.length,
		successCount: results.filter((r) => r.success).length,
		failureCount: results.filter((r) => !r.success).length,
		needsReviewCount: results.filter((r) => r.needsReview).length,
		results,
	};

	const summaryPath = path.join(outputDir, "batch_summary.json");
	await saveAsJSON(summary, summaryPath);

	const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
	console.log(`\n=== Batch Processing Complete ===`);
	console.log(`Total duration: ${totalDuration}s`);
	console.log(`Document groups: ${summary.totalGroups}`);
	console.log(`Files processed: ${summary.totalFiles}`);
	console.log(`Successful: ${summary.successCount}`);
	console.log(`Failed: ${summary.failureCount}`);
	console.log(`Needs review: ${summary.needsReviewCount}`);

	// Summary of classifications
	let totalRelevantPages = 0;
	let totalPages = 0;
	for (const result of results) {
		if (result.classification) {
			totalRelevantPages += result.classification.relevantPages;
			totalPages += result.classification.totalPages;
		}
	}
	console.log(`Total pages: ${totalPages} (${totalRelevantPages} relevant)`);

	if (summary.failureCount > 0) {
		console.log(`\nFailed groups:`);
		for (const result of results.filter((r) => !r.success)) {
			console.log(`  - ${result.groupPrefix}: ${result.error}`);
		}
	}

	if (summary.needsReviewCount > 0) {
		console.log(`\nGroups needing review:`);
		for (const result of results.filter((r) => r.needsReview && r.success)) {
			console.log(`  - ${result.groupPrefix}`);
		}
	}

	console.log(`\nResults saved to: ${outputDir}/`);
}

main();
