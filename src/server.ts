import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { classifyPages, filterRelevantPages } from "./lib/classifier.js";
import { getConfig, getConfigFromEnv } from "./lib/config.js";
import { runExtractionPass } from "./lib/extractor-twopass.js";
import { processPDF } from "./lib/pdf-processor.js";
import { transformToLademittelmahnung } from "./lib/transform.js";
import { validateExtraction } from "./lib/validation.js";
import type { TwoPassExtractionResult } from "./types/index.js";

function formatSummary(
	extractions: TwoPassExtractionResult[],
	processingTimeMs: number,
	needsReviewCount: number,
): string {
	const lines: string[] = [];
	const duration = (processingTimeMs / 1000).toFixed(2);

	lines.push("=== Extraction Complete ===");
	lines.push(`Duration: ${duration}s`);
	lines.push(`Extractions: ${extractions.length}`);

	if (needsReviewCount > 0) {
		lines.push("");
		lines.push(
			`⚠️  ${needsReviewCount} extraction(s) flagged for manual review`,
		);
	}

	for (const extraction of extractions) {
		lines.push("");
		lines.push(`Pallet Type: ${extraction.palletType}`);
		lines.push(`  Pickup: ${extraction.pickup.location || "Unknown"}`);
		lines.push(`    Date: ${extraction.pickup.date || "Unknown"}`);
		lines.push(`    übernommen: ${extraction.pickup.übernommen}`);
		lines.push(`  Delivery: ${extraction.delivery.location || "Unknown"}`);
		lines.push(`    Date: ${extraction.delivery.date || "Unknown"}`);
		lines.push(`    überlassen: ${extraction.delivery.überlassen}`);
		lines.push(`    übernommen: ${extraction.delivery.übernommen}`);
		lines.push(
			`  Exchanged: ${extraction.exchangeStatus.exchanged ?? "Unknown"}`,
		);
		lines.push(`  Saldo: ${extraction.saldo}`);
		lines.push(`  Confidence: ${(extraction.confidence * 100).toFixed(1)}%`);
	}

	return lines.join("\n");
}

const app = new Hono();

app.use("*", cors());

app.use("/process", bodyLimit({ maxSize: 100 * 1024 * 1024 })); // 100MB total

app.use("/process", async (c, next) => {
	const apiKey = c.req.header("X-API-Key") ?? "";
	const expected = env.API_KEY;
	const isValid =
		apiKey.length === expected.length &&
		crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected));
	if (!isValid) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
});

app.get("/health", (c) => {
	const config = getConfig(getConfigFromEnv());
	return c.json({
		status: "ok",
		classificationModel: config.classification.model,
		extractionModel: config.extraction.model,
	});
});

app.post("/process", async (c) => {
	const startTime = Date.now();
	let tempDir: string | undefined;

	try {
		const formData = await c.req.formData();
		const files = formData.getAll("files");

		if (files.length === 0) {
			return c.json({ error: "No files provided" }, 400);
		}

		if (files.length > 10) {
			return c.json({ error: "Too many files (max 10)" }, 400);
		}

		const maxSize = 10 * 1024 * 1024; // 10MB
		for (const file of files) {
			if (file instanceof File && file.size > maxSize) {
				return c.json(
					{ error: `File too large: ${file.name} (max 10MB)` },
					400,
				);
			}
		}

		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pallet-extract-"));
		const pdfPaths: string[] = [];

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			if (!(file instanceof File)) {
				continue;
			}

			if (
				file.type !== "application/pdf" &&
				!file.name.toLowerCase().endsWith(".pdf")
			) {
				return c.json({ error: `Invalid file type: ${file.name}` }, 400);
			}

			const fileName = file.name || `upload_${i}.pdf`;
			const filePath = path.join(tempDir, fileName);
			const buffer = Buffer.from(await file.arrayBuffer());
			await fs.writeFile(filePath, buffer);
			pdfPaths.push(filePath);
		}

		if (pdfPaths.length === 0) {
			return c.json({ error: "No valid PDF files found" }, 400);
		}

		const config = getConfig(getConfigFromEnv());

		// Step 1: Process all PDFs and combine pages
		const allPages = [];
		let totalPdfPages = 0;

		for (const pdfPath of pdfPaths) {
			const pdfResult = await processPDF(pdfPath);
			allPages.push(...pdfResult.pages);
			totalPdfPages += pdfResult.totalPages;
		}

		// Step 2: Classification pass
		const classification = await classifyPages(allPages, config);

		if (classification.relevantPages === 0) {
			return c.json({
				success: true,
				processingTimeMs: Date.now() - startTime,
				filesProcessed: pdfPaths.length,
				pagesProcessed: totalPdfPages,
				relevantPages: 0,
				extractionsCount: 0,
				needsReview: false,
				classification: classification.pages,
				extractions: [],
				lademittelmahnung: [],
				message: "No pallet-relevant documents found",
			});
		}

		// Step 3: Filter to relevant pages
		const { relevantPages, metadata } = filterRelevantPages(
			allPages,
			classification,
		);

		// Step 4: Extraction pass
		const extractionResult = await runExtractionPass(
			relevantPages,
			metadata,
			config,
		);

		if (!extractionResult.success) {
			return c.json(
				{
					error: extractionResult.error || "Extraction failed",
					processingTimeMs: Date.now() - startTime,
					classification: classification.pages,
				},
				500,
			);
		}

		// Step 5: Validate extractions
		const validations = extractionResult.extractions.map((e) =>
			validateExtraction(e, config),
		);
		const validatedExtractions = validations.map((v) => v.result);

		// Step 6: Transform to Lademittelmahnung format
		const lademittelmahnungResults = validatedExtractions.map((extraction, i) =>
			transformToLademittelmahnung(extraction, validations[i], config),
		);

		const needsReviewCount = lademittelmahnungResults.filter(
			(r) => r.needsReview,
		).length;

		const processingTimeMs = Date.now() - startTime;
		const summary = formatSummary(
			validatedExtractions,
			processingTimeMs,
			needsReviewCount,
		);

		return c.json({
			success: true,
			processingTimeMs,
			filesProcessed: pdfPaths.length,
			pagesProcessed: totalPdfPages,
			relevantPages: classification.relevantPages,
			extractionsCount: validatedExtractions.length,
			needsReview: needsReviewCount > 0,
			needsReviewCount,
			summary,
			classification: classification.pages,
			extractions: validatedExtractions,
			lademittelmahnung: lademittelmahnungResults,
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error("Processing error:", errorMessage);

		return c.json(
			{
				error: errorMessage,
				processingTimeMs: Date.now() - startTime,
			},
			500,
		);
	} finally {
		if (tempDir) {
			try {
				await fs.rm(tempDir, { recursive: true, force: true });
			} catch (e) {
				console.warn("Temp cleanup failed:", e);
			}
		}
	}
});

const port = env.PORT;
const config = getConfig(getConfigFromEnv());

console.log(`Starting server on port ${port}...`);
console.log(`Classification model: ${config.classification.model}`);
console.log(`Extraction model: ${config.extraction.model}`);

serve({
	fetch: app.fetch,
	port,
});

console.log(`Server running at http://localhost:${port}`);
console.log(`POST /process - Upload PDFs via form-data with field "files"`);
console.log(`GET /health - Health check`);
