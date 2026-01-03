import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { processDocumentGroup } from "./lib/document-grouper.js";
import { extractDocumentGroup } from "./lib/extractor-v010.js";
import { v010ToLademittelmahnungFormat } from "./lib/output-generator.js";
import { validateAndEnrich } from "./lib/post-processor.js";
import type { V010ExtractionData } from "./types/index.js";

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
	return c.json({ status: "ok", model: env.OPENROUTER_MODEL });
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

		const prefix = `upload_${Date.now()}`;
		const group = await processDocumentGroup(prefix, pdfPaths);

		const result = await extractDocumentGroup(group);

		if (!result.success) {
			return c.json(
				{
					error: result.error || "Extraction failed",
					processingTimeMs: Date.now() - startTime,
				},
				500,
			);
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

		return c.json({
			success: true,
			processingTimeMs: Date.now() - startTime,
			filesProcessed: pdfPaths.length,
			pagesProcessed: group.pages.length,
			extractionsCount: validExtractions.length,
			needsReview: enriched.needsReview,
			extractions: validExtractions,
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
console.log(`Starting server on port ${port}...`);
console.log(`Model: ${env.OPENROUTER_MODEL}`);
console.log(
	`Custom prompt: ${env.EXTRACTION_PROMPT_BASE64 ? "Yes (base64)" : "No (using default)"}`,
);

serve({
	fetch: app.fetch,
	port,
});

console.log(`Server running at http://localhost:${port}`);
console.log(`POST /process - Upload PDFs via form-data with field "files"`);
console.log(`GET /health - Health check`);
