#!/usr/bin/env node
import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { processDocumentGroup } from "./lib/document-grouper.js";
import { extractDocumentGroup } from "./lib/extractor-v010.js";
import {
	saveAsJSON,
	v010ToLademittelmahnungFormat,
} from "./lib/output-generator.js";
import { validateAndEnrich } from "./lib/post-processor.js";
import type { V010ExtractionData } from "./types/index.js";

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

	console.log(`\n=== Pallet Movement Extraction (v0.10) ===`);
	console.log(`Input:  ${input}`);
	console.log(`Output: ${outputDir}/`);
	console.log();

	try {
		console.log("Step 1: Processing PDF and grouping pages...");
		const group = await processDocumentGroup(basename, [input]);
		console.log(`  Processed ${group.pages.length} pages`);

		console.log("\nStep 2: Extracting data (single-pass)...");
		const result = await extractDocumentGroup(group);

		if (!result.success) {
			throw new Error(result.error || "Extraction failed");
		}

		console.log("\nStep 3: Validating and enriching...");
		const enriched = validateAndEnrich(result);

		const extractions = Array.isArray(enriched.data)
			? enriched.data
			: [enriched.data];
		const validExtractions = extractions.filter(
			(e): e is V010ExtractionData => e !== undefined,
		);

		console.log("\nStep 4: Converting to Lademittelmahnung format...");
		const lademittelmahnungResults = validExtractions.map(
			v010ToLademittelmahnungFormat,
		);

		console.log("\nStep 5: Saving results...");

		const extractionPath = outputFile.replace(".json", "_extraction.json");
		await saveAsJSON(validExtractions, extractionPath);

		if (lademittelmahnungResults.length > 0) {
			await saveAsJSON(lademittelmahnungResults, outputFile);
		}

		const duration = ((Date.now() - startTime) / 1000).toFixed(2);
		console.log(`\n=== Extraction Complete ===`);
		console.log(`Duration: ${duration}s`);
		console.log(`Extractions: ${validExtractions.length}`);

		if (enriched.needsReview) {
			console.log(
				`\nNOTE: Results flagged for manual review (low confidence or issues detected)`,
			);
		}

		for (const extraction of validExtractions) {
			console.log(
				`\nDocument: ${extraction.documentType} (${extraction.locationType})`,
			);
			console.log(`  Location: ${extraction.location.name || "Unknown"}`);
			console.log(`  Date: ${extraction.date || "Unknown"}`);
			console.log(`  Confidence: ${(extraction.confidence * 100).toFixed(1)}%`);

			if (extraction.palletsGiven.length > 0) {
				console.log(`  Pallets Given:`);
				for (const m of extraction.palletsGiven) {
					console.log(`    ${m.type}: ${m.qty}`);
				}
			}

			if (extraction.palletsReceived.length > 0) {
				console.log(`  Pallets Received:`);
				for (const m of extraction.palletsReceived) {
					console.log(`    ${m.type}: ${m.qty}`);
				}
			}

			console.log(`  Exchanged: ${extraction.exchanged ?? "Unknown"}`);
			console.log(`  Saldo: ${extraction.saldo ?? "N/A"}`);
		}

		console.log(`\nRaw extraction saved to: ${extractionPath}`);
		if (lademittelmahnungResults.length > 0) {
			console.log(`Condensed results saved to: ${outputFile}`);
		}
	} catch (error) {
		console.error("\nError during extraction:", error);
		process.exit(1);
	}
}

main();
