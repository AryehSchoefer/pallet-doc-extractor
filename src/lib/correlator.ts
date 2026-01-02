import type {
	DeliveryExtraction,
	DocumentPage,
	PalletMovement,
	PDFPage,
	StopExtraction,
	V2ExtractionData,
	V2PalletMovement,
} from "../types/index.js";
import { classifyPage } from "./classifier.js";
import { extractPage } from "./extractor.js";

function v2ToPalletMovement(movements: V2PalletMovement[]): PalletMovement[] {
	return movements.map((m) => ({
		palletType: m.type,
		quantity: m.qty,
		damaged: m.damaged,
	}));
}

function mergePalletMovements(movements: PalletMovement[]): PalletMovement[] {
	const merged = new Map<string, PalletMovement>();

	for (const movement of movements) {
		const key = movement.palletType;
		const existing = merged.get(key);
		if (existing) {
			existing.quantity += movement.quantity;
			if (movement.damaged) {
				existing.damaged = (existing.damaged || 0) + movement.damaged;
			}
		} else {
			merged.set(key, { ...movement });
		}
	}

	return Array.from(merged.values());
}

function extractionToStop(data: V2ExtractionData): StopExtraction {
	let palletsReceived: PalletMovement[];
	let palletsGiven: PalletMovement[];

	if (data.perspective === "location") {
		palletsReceived = v2ToPalletMovement(data.palletsGiven);
		palletsGiven = v2ToPalletMovement(data.palletsReceived);
	} else {
		palletsReceived = v2ToPalletMovement(data.palletsReceived);
		palletsGiven = v2ToPalletMovement(data.palletsGiven);
	}

	return {
		locationType: data.locationType,
		locationName: data.location.name || "Unknown",
		locationAddress: data.location.address || undefined,
		date: data.date || undefined,
		palletsReceived,
		palletsGiven,
		exchanged: data.exchanged ?? false,
		signatures: data.signatures,
		notes: data.notes.length > 0 ? data.notes : undefined,
	};
}

function mergeStops(stops: StopExtraction[]): StopExtraction[] {
	const locationMap = new Map<string, StopExtraction>();

	for (const stop of stops) {
		const key = `${stop.locationType}_${stop.locationName.toLowerCase()}`;

		const existing = locationMap.get(key);
		if (existing) {
			existing.palletsReceived = mergePalletMovements([
				...existing.palletsReceived,
				...stop.palletsReceived,
			]);
			existing.palletsGiven = mergePalletMovements([
				...existing.palletsGiven,
				...stop.palletsGiven,
			]);
			existing.date = existing.date || stop.date;
			existing.locationAddress =
				existing.locationAddress || stop.locationAddress;
			existing.exchanged = existing.exchanged || stop.exchanged;
			if (stop.signatures) {
				existing.signatures = {
					driver: existing.signatures?.driver || stop.signatures.driver,
					customer: existing.signatures?.customer || stop.signatures.customer,
				};
			}
			if (stop.notes) {
				existing.notes = [...(existing.notes || []), ...stop.notes];
			}
		} else {
			locationMap.set(key, { ...stop });
		}
	}

	return Array.from(locationMap.values());
}

export async function correlateDocuments(
	pages: PDFPage[],
	sourceFile: string,
): Promise<DeliveryExtraction> {
	const processedPages: DocumentPage[] = [];
	const allWarnings: string[] = [];
	const allStops: StopExtraction[] = [];

	const references: DeliveryExtraction["references"] = {};
	let shipper: string | undefined;
	let consignee: string | undefined;
	let consigneeAddress: string | undefined;
	let vehiclePlate: string | undefined;
	let driverName: string | undefined;
	let totalConfidence = 0;

	for (const page of pages) {
		try {
			const classification = await classifyPage(page);
			const extraction = await extractPage(page);

			processedPages.push({
				pageNumber: page.pageNumber,
				documentType: classification.documentType,
				confidence: classification.confidence,
				rawExtraction: extraction.data,
			});

			if (!extraction.success || !extraction.data) {
				allWarnings.push(`Page ${page.pageNumber}: extraction failed`);
				continue;
			}

			const data = extraction.data;
			totalConfidence += data.confidence;
			allWarnings.push(...data.warnings);

			references.orderNumber =
				references.orderNumber || data.references.order || undefined;
			references.deliveryNumber =
				references.deliveryNumber || data.references.delivery || undefined;
			references.tourNumber =
				references.tourNumber || data.references.tour || undefined;

			shipper = shipper || data.parties.sender?.name || undefined;
			consignee = consignee || data.parties.recipient?.name || undefined;
			consigneeAddress =
				consigneeAddress || data.parties.recipient?.address || undefined;

			if (data.documentType === "ladeliste") {
				driverName =
					driverName ||
					data.notes.find((n) => n.includes("driver")) ||
					undefined;
			}

			if (
				data.location.name ||
				data.palletsGiven.length > 0 ||
				data.palletsReceived.length > 0
			) {
				allStops.push(extractionToStop(data));
			}
		} catch (error) {
			allWarnings.push(
				`Page ${page.pageNumber}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	if (allStops.length === 0 && consignee) {
		allWarnings.push("No stops extracted from documents");
	}

	const hasPickupStops = allStops.some((s) => s.locationType === "pickup");
	const hasDeliveryStops = allStops.some((s) => s.locationType === "delivery");

	if (hasPickupStops && !hasDeliveryStops && consignee) {
		const pickupPallets = allStops
			.filter((s) => s.locationType === "pickup")
			.flatMap((s) => s.palletsReceived);

		if (pickupPallets.length > 0) {
			allStops.push({
				locationType: "delivery",
				locationName: consignee,
				locationAddress: consigneeAddress,
				palletsReceived: pickupPallets.map((p) => ({ ...p })),
				palletsGiven: pickupPallets.map((p) => ({ ...p })),
				exchanged: true,
			});
			allWarnings.push(
				"Created delivery stop from consignee - assumed pallet exchange",
			);
		}
	}

	const mergedStops = mergeStops(allStops);
	const avgConfidence =
		processedPages.length > 0 ? totalConfidence / processedPages.length : 0;

	return {
		references,
		shipper,
		consignee,
		vehiclePlate,
		driverName,
		stops: mergedStops,
		sourceFile,
		processedPages,
		extractionConfidence: avgConfidence,
		warnings: allWarnings,
	};
}

export async function processDeliveryDocument(
	pages: PDFPage[],
	sourceFile: string,
): Promise<DeliveryExtraction> {
	console.log(`Processing ${pages.length} pages from ${sourceFile}`);

	const extraction = await correlateDocuments(pages, sourceFile);

	console.log(
		`Extracted ${extraction.stops.length} stops with confidence ${extraction.extractionConfidence.toFixed(2)}`,
	);

	if (extraction.warnings.length > 0) {
		console.log(`Warnings: ${extraction.warnings.length}`);
		for (const warning of extraction.warnings) {
			console.log(`  - ${warning}`);
		}
	}

	return extraction;
}
