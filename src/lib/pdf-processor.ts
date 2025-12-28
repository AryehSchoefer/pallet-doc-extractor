import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pdf } from "pdf-to-img";
import type { PDFPage, PDFProcessingResult } from "../types/index.js";

export async function processPDF(
	filePath: string,
): Promise<PDFProcessingResult> {
	const absolutePath = path.resolve(filePath);

	try {
		await fs.access(absolutePath);
	} catch {
		throw new Error(`PDF file not found: ${absolutePath}`);
	}

	const pages: PDFPage[] = [];
	let pageNumber = 0;

	const document = await pdf(absolutePath, {
		scale: 2.0,
	});

	for await (const image of document) {
		pageNumber++;
		const base64 = image.toString("base64");

		pages.push({
			pageNumber,
			imageBase64: base64,
			width: 0,
			height: 0,
		});
	}

	return {
		filePath: absolutePath,
		totalPages: pageNumber,
		pages,
	};
}

export function toDataURL(
	base64: string,
	mimeType: string = "image/png",
): string {
	return `data:${mimeType};base64,${base64}`;
}

export async function savePageImage(
	page: PDFPage,
	outputDir: string,
	baseName: string,
): Promise<string> {
	const filename = `${baseName}_page_${page.pageNumber}.png`;
	const outputPath = path.join(outputDir, filename);

	await fs.mkdir(outputDir, { recursive: true });
	await fs.writeFile(outputPath, Buffer.from(page.imageBase64, "base64"));

	return outputPath;
}

export async function processDirectory(
	dirPath: string,
	pattern: RegExp = /\.pdf$/i,
): Promise<Map<string, PDFProcessingResult>> {
	const results = new Map<string, PDFProcessingResult>();
	const absolutePath = path.resolve(dirPath);

	const entries = await fs.readdir(absolutePath, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isFile() && pattern.test(entry.name)) {
			const filePath = path.join(absolutePath, entry.name);
			try {
				const result = await processPDF(filePath);
				results.set(entry.name, result);
			} catch (error) {
				console.error(`Failed to process ${entry.name}:`, error);
			}
		}
	}

	return results;
}
