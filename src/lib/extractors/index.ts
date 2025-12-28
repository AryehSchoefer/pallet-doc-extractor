export { extractLadeliste } from "./ladeliste.js";
export { extractLieferschein } from "./lieferschein.js";
export { extractPalettennachweis } from "./palettennachweis.js";
export { extractWareneingangsbeleg } from "./wareneingangsbeleg.js";

import type {
	DocumentType,
	ExtractionResult,
	PDFPage,
} from "../../types/index.js";
import { extractLadeliste } from "./ladeliste.js";
import { extractLieferschein } from "./lieferschein.js";
import { extractPalettennachweis } from "./palettennachweis.js";
import { extractWareneingangsbeleg } from "./wareneingangsbeleg.js";

export async function extractByType(
	page: PDFPage,
	documentType: DocumentType,
): Promise<ExtractionResult<unknown>> {
	switch (documentType) {
		case "lieferschein":
			return extractLieferschein(page);
		case "palettennachweis":
			return extractPalettennachweis(page);
		case "wareneingangsbeleg":
			return extractWareneingangsbeleg(page);
		case "ladeliste":
			return extractLadeliste(page);
		default:
			return {
				success: false,
				confidence: 0,
				warnings: ["Unknown document type - no extraction performed"],
			};
	}
}
