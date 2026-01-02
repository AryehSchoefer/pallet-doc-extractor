#!/usr/bin/env node
import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { processDeliveryDocument } from "./lib/correlator.js";
import {
	generateExcel,
	saveAsJSON,
	toLademittelmahnungFormat,
} from "./lib/output-generator.js";
import { processPDF } from "./lib/pdf-processor.js";
import type {
	BatchProcessingResult,
	BatchSummary,
	LademittelmahnungOutput,
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

async function processSingleFile(
	inputPath: string,
	outputDir: string,
): Promise<BatchProcessingResult> {
	const startTime = Date.now();
	const filename = path.basename(inputPath);
	const basename = path.basename(inputPath, ".pdf");

	try {
		console.log(`\nProcessing: ${filename}`);

		const pdfResult = await processPDF(inputPath);
		console.log(`  Pages: ${pdfResult.totalPages}`);

		const extraction = await processDeliveryDocument(pdfResult.pages, filename);

		const lademittelmahnung = toLademittelmahnungFormat(extraction);

		const extractionPath = path.join(outputDir, `${basename}_extraction.json`);
		await saveAsJSON(extraction, extractionPath);

		let lademittelmahnungPath: string | undefined;
		if (lademittelmahnung) {
			lademittelmahnungPath = path.join(outputDir, `${basename}_result.json`);
			await saveAsJSON(lademittelmahnung, lademittelmahnungPath);
		}

		const duration = Date.now() - startTime;
		console.log(
			`  Complete (${(duration / 1000).toFixed(2)}s) - Confidence: ${(extraction.extractionConfidence * 100).toFixed(1)}%`,
		);

		return {
			inputFile: inputPath,
			success: true,
			extraction,
			lademittelmahnung: lademittelmahnung || undefined,
			processingTimeMs: duration,
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`  Error: ${errorMessage}`);

		return {
			inputFile: inputPath,
			success: false,
			error: errorMessage,
			processingTimeMs: duration,
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

	console.log(`\n=== Batch Pallet Movement Extraction ===`);
	console.log(`Input directory:  ${input}`);
	console.log(`Output directory: ${outputDir}/`);

	const pdfFiles = await findPDFFiles(input);

	if (pdfFiles.length === 0) {
		console.error(`\nNo PDF files found in ${input}`);
		process.exit(1);
	}

	console.log(`\nFound ${pdfFiles.length} PDF file(s)`);

	await fs.mkdir(outputDir, { recursive: true });

	const results: BatchProcessingResult[] = [];
	const lademittelmahnungResults: LademittelmahnungOutput[] = [];

	for (const pdfFile of pdfFiles) {
		const result = await processSingleFile(pdfFile, outputDir);
		results.push(result);

		if (result.lademittelmahnung) {
			lademittelmahnungResults.push(result.lademittelmahnung);
		}
	}

	if (lademittelmahnungResults.length > 0) {
		console.log("\nGenerating combined Excel file...");
		const excelPath = path.join(outputDir, "combined_results.xlsx");
		await generateExcel(lademittelmahnungResults, excelPath);
	}

	const summary: BatchSummary = {
		totalFiles: pdfFiles.length,
		successCount: results.filter((r) => r.success).length,
		failureCount: results.filter((r) => !r.success).length,
		results,
	};

	const summaryPath = path.join(outputDir, "batch_summary.json");
	await saveAsJSON(summary, summaryPath);

	const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
	console.log(`\n=== Batch Processing Complete ===`);
	console.log(`Total duration: ${totalDuration}s`);
	console.log(`Files processed: ${summary.totalFiles}`);
	console.log(`Successful: ${summary.successCount}`);
	console.log(`Failed: ${summary.failureCount}`);

	if (summary.failureCount > 0) {
		console.log(`\nFailed files:`);
		for (const result of results.filter((r) => !r.success)) {
			console.log(`  - ${path.basename(result.inputFile)}: ${result.error}`);
		}
	}

	console.log(`\nResults saved to: ${outputDir}/`);
}

main();
