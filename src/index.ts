#!/usr/bin/env node
import "dotenv/config";
import * as path from "node:path";
import { processDeliveryDocument } from "./lib/correlator.js";
import {
	saveAsJSON,
	toLademittelmahnungFormat,
} from "./lib/output-generator.js";
import { processPDF } from "./lib/pdf-processor.js";

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

	console.log(`\n=== Pallet Movement Extraction ===`);
	console.log(`Input:  ${input}`);
	console.log(`Output: ${output}`);
	console.log();

	try {
		console.log("Step 1: Converting PDF to images...");
		const pdfResult = await processPDF(input);
		console.log(`  Processed ${pdfResult.totalPages} pages`);

		console.log("\nStep 2: Classifying and extracting data...");
		const extraction = await processDeliveryDocument(
			pdfResult.pages,
			path.basename(input),
		);

		console.log("\nStep 3: Converting to Lademittelmahnung format...");
		const lademittelmahnung = toLademittelmahnungFormat(extraction);

		if (!lademittelmahnung) {
			console.warn(
				"Warning: Could not generate Lademittelmahnung output (no valid stops found)",
			);
		}

		console.log("\nStep 4: Saving results...");

		const extractionPath = output.replace(".json", "_extraction.json");
		await saveAsJSON(extraction, extractionPath);

		if (lademittelmahnung) {
			await saveAsJSON(lademittelmahnung, output);
		}

		const duration = ((Date.now() - startTime) / 1000).toFixed(2);
		console.log(`\n=== Extraction Complete ===`);
		console.log(`Duration: ${duration}s`);
		console.log(`Pages processed: ${extraction.processedPages.length}`);
		console.log(`Stops found: ${extraction.stops.length}`);
		console.log(
			`Confidence: ${(extraction.extractionConfidence * 100).toFixed(1)}%`,
		);

		if (extraction.warnings.length > 0) {
			console.log(`\nWarnings (${extraction.warnings.length}):`);
			for (const warning of extraction.warnings.slice(0, 5)) {
				console.log(`  - ${warning}`);
			}
			if (extraction.warnings.length > 5) {
				console.log(`  ... and ${extraction.warnings.length - 5} more`);
			}
		}

		if (lademittelmahnung) {
			console.log(`\nPallet Movements:`);
			for (const movement of lademittelmahnung.palletMovements) {
				console.log(
					`  ${movement.palletType}: Pickup +${movement.pickupReceived}/-${movement.pickupGiven} | Delivery +${movement.deliveryReceived}/-${movement.deliveryGiven} | Saldo: ${movement.saldo}`,
				);
			}
		}

		console.log(`\nRaw extraction saved to: ${extractionPath}`);
		if (lademittelmahnung) {
			console.log(`Condensed results saved to: ${output}`);
		} else {
			console.log(
				`Note: Condensed results file was NOT created (no valid stops found)`,
			);
		}
	} catch (error) {
		console.error("\nError during extraction:", error);
		process.exit(1);
	}
}

main();
