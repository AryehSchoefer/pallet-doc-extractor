#!/usr/bin/env node
import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	groupFilesByPrefix,
	processDocumentGroup,
} from "./lib/document-grouper.js";
import { extractDocumentGroup } from "./lib/extractor-v010.js";
import {
	generateExcel,
	saveAsJSON,
	v010ToLademittelmahnungFormat,
} from "./lib/output-generator.js";
import { validateAndEnrich } from "./lib/post-processor.js";
import type {
	LademittelmahnungOutput,
	V010BatchProcessingResult,
	V010BatchSummary,
	V010ExtractionData,
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
): Promise<V010BatchProcessingResult> {
	const startTime = Date.now();

	try {
		console.log(`\nProcessing group: ${prefix} (${files.length} file(s))`);
		for (const file of files) {
			console.log(`  - ${path.basename(file)}`);
		}

		const group = await processDocumentGroup(prefix, files);
		console.log(`  Total pages: ${group.pages.length}`);

		const result = await extractDocumentGroup(group);

		if (!result.success) {
			throw new Error(result.error || "Extraction failed");
		}

		const enriched = validateAndEnrich(result);

		const extractions = Array.isArray(enriched.data)
			? enriched.data
			: enriched.data
				? [enriched.data]
				: [];

		const validExtractions = extractions.filter(
			(e): e is V010ExtractionData => e !== undefined,
		);

		const lademittelmahnungResults = validExtractions.map(
			v010ToLademittelmahnungFormat,
		);

		const extractionPath = path.join(outputDir, `${prefix}_extraction.json`);
		await saveAsJSON(validExtractions, extractionPath);

		if (lademittelmahnungResults.length > 0) {
			const resultPath = path.join(outputDir, `${prefix}_result.json`);
			await saveAsJSON(lademittelmahnungResults, resultPath);
		}

		const duration = Date.now() - startTime;
		const avgConfidence =
			validExtractions.length > 0
				? validExtractions.reduce((sum, e) => sum + e.confidence, 0) /
					validExtractions.length
				: 0;

		console.log(
			`  Complete (${(duration / 1000).toFixed(2)}s) - Confidence: ${(avgConfidence * 100).toFixed(1)}%`,
		);

		if (enriched.needsReview) {
			console.log(`  NOTE: Flagged for review`);
		}

		return {
			groupPrefix: prefix,
			inputFiles: files,
			success: true,
			extractions: validExtractions,
			lademittelmahnung: lademittelmahnungResults,
			processingTimeMs: duration,
			needsReview: enriched.needsReview,
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

	const timestamp = Date.now();
	const outputDir = path.join(output, String(timestamp));

	console.log(`\n=== Batch Pallet Movement Extraction (v0.10) ===`);
	console.log(`Input directory:  ${input}`);
	console.log(`Output directory: ${outputDir}/`);

	const pdfFiles = await findPDFFiles(input);

	if (pdfFiles.length === 0) {
		console.error(`\nNo PDF files found in ${input}`);
		process.exit(1);
	}

	console.log(`\nFound ${pdfFiles.length} PDF file(s)`);

	const fileGroups = groupFilesByPrefix(pdfFiles);
	console.log(`Grouped into ${fileGroups.size} document group(s)`);

	await fs.mkdir(outputDir, { recursive: true });

	const results: V010BatchProcessingResult[] = [];
	const allLademittelmahnungResults: LademittelmahnungOutput[] = [];

	for (const [prefix, files] of fileGroups) {
		const result = await processGroup(prefix, files, outputDir);
		results.push(result);

		if (result.lademittelmahnung) {
			allLademittelmahnungResults.push(...result.lademittelmahnung);
		}
	}

	if (allLademittelmahnungResults.length > 0) {
		console.log("\nGenerating combined Excel file...");
		const excelPath = path.join(outputDir, "combined_results.xlsx");
		await generateExcel(allLademittelmahnungResults, excelPath);
	}

	const summary: V010BatchSummary = {
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
