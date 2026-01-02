import * as path from "node:path";
import type { DocumentGroup, PDFPage } from "../types/index.js";
import { processPDF } from "./pdf-processor.js";

/**
 * Extract the base prefix from a filename.
 * Examples:
 *   F1250031939.pdf → F1250031939
 *   F1250031939_2.pdf → F1250031939
 *   F1250031939-page2.pdf → F1250031939
 *   document_part1.pdf → document
 */
export function extractFilePrefix(filename: string): string {
	const basename = path.basename(filename, path.extname(filename));
	// Remove common suffixes: _2, _page2, -2, -page2, _part1, etc.
	return basename.replace(/[_-](?:\d+|page\d+|part\d+)$/i, "");
}

/**
 * Group files by their extracted prefix.
 * Returns a Map where keys are prefixes and values are arrays of file paths.
 */
export function groupFilesByPrefix(filePaths: string[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();

	for (const filePath of filePaths) {
		const prefix = extractFilePrefix(filePath);
		const existing = groups.get(prefix) || [];
		existing.push(filePath);
		groups.set(prefix, existing);
	}

	// Sort files within each group for consistent ordering
	for (const [prefix, files] of groups) {
		groups.set(prefix, files.sort());
	}

	return groups;
}

export async function processDocumentGroup(
	prefix: string,
	filePaths: string[],
): Promise<DocumentGroup> {
	const allPages: PDFPage[] = [];
	let globalPageNumber = 0;

	const sortedPaths = [...filePaths].sort();

	for (const filePath of sortedPaths) {
		const pdfResult = await processPDF(filePath);

		for (const page of pdfResult.pages) {
			globalPageNumber++;
			allPages.push({
				...page,
				pageNumber: globalPageNumber,
			});
		}
	}

	return {
		prefix,
		files: sortedPaths,
		pages: allPages,
	};
}

export async function processAllGroups(
	filePaths: string[],
): Promise<DocumentGroup[]> {
	const groups = groupFilesByPrefix(filePaths);
	const results: DocumentGroup[] = [];

	for (const [prefix, files] of groups) {
		const group = await processDocumentGroup(prefix, files);
		results.push(group);
	}

	return results;
}
