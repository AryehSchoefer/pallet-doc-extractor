#!/usr/bin/env node
import * as path from "node:path";
import { generateExcel, loadJSONResults } from "./lib/output-generator.js";

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
			"Usage: pnpm generate:excel -- --input <directory> [--output <excel-file>]",
		);
		process.exit(1);
	}

	if (!output) {
		output = path.join(input, "results.xlsx");
	}

	return { input, output };
}

async function main(): Promise<void> {
	const { input, output } = parseArgs();

	console.log(`\n=== Generate Excel from JSON Results ===`);
	console.log(`Input directory:  ${input}`);
	console.log(`Output file:      ${output}`);
	console.log();

	try {
		console.log("Loading JSON results...");
		const results = await loadJSONResults(input);

		if (results.length === 0) {
			console.error(
				"No valid Lademittelmahnung JSON files found in the input directory",
			);
			process.exit(1);
		}

		console.log(`Found ${results.length} result file(s)`);

		console.log("\nGenerating Excel file...");
		await generateExcel(results, output);

		let totalMovements = 0;
		for (const result of results) {
			totalMovements += result.palletMovements.length;
		}

		console.log(`\n=== Generation Complete ===`);
		console.log(`Deliveries: ${results.length}`);
		console.log(`Pallet movements: ${totalMovements}`);
		console.log(`Output: ${output}`);
	} catch (error) {
		console.error("\nError generating Excel:", error);
		process.exit(1);
	}
}

main();
