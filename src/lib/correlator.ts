import type {
	ClassificationResult,
	DeliveryExtraction,
	DocumentPage,
	ExtractionResult,
	LadelisteData,
	LieferscheinData,
	PalettennachweisData,
	PalletMovement,
	PDFPage,
	StopExtraction,
	WareneingangselegData,
} from "../types/index.js";
import { classifyPage } from "./classifier.js";
import { extractByType } from "./extractors/index.js";

async function processPage(page: PDFPage): Promise<{
	classification: ClassificationResult;
	extraction: ExtractionResult<unknown>;
	documentPage: DocumentPage;
}> {
	const classification = await classifyPage(page);
	const extraction = await extractByType(page, classification.documentType);

	const documentPage: DocumentPage = {
		pageNumber: page.pageNumber,
		documentType: classification.documentType,
		confidence: classification.confidence,
		rawExtraction: extraction.data,
	};

	return { classification, extraction, documentPage };
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

function extractStopsFromLieferschein(
	_data: LieferscheinData,
): Partial<StopExtraction>[] {
	// Lieferschein contains shipper/consignee info, not physical stop locations
	return [];
}

// Palettennachweis is from location's perspective - swap to carrier's perspective
function extractStopsFromPalettennachweis(
	data: PalettennachweisData,
): Partial<StopExtraction>[] {
	const carrierReceived = data.palletsGiven;
	const carrierGave = data.palletsReceived;

	const totalReceived = carrierReceived.reduce((sum, p) => sum + p.quantity, 0);
	const totalGave = carrierGave.reduce((sum, p) => sum + p.quantity, 0);

	let locationType: "pickup" | "delivery";
	if (totalReceived > 0 && totalGave === 0) {
		locationType = "pickup";
	} else if (totalGave > 0 && totalReceived === 0) {
		locationType = "delivery";
	} else if (totalReceived > totalGave) {
		locationType = "pickup";
	} else {
		locationType = "delivery";
	}

	const locationName = data.fromCompany || data.toCompany || "Unknown";
	const locationAddress = data.location;

	const stop: Partial<StopExtraction> = {
		locationType,
		locationName,
		locationAddress,
		date: data.date,
		palletsReceived: carrierReceived,
		palletsGiven: carrierGave,
		exchanged: carrierReceived.length > 0 && carrierGave.length > 0,
		signatures: data.signatures,
		notes: data.notes,
	};

	return [stop];
}

// Wareneingangsbeleg is from recipient's perspective - swap to carrier's perspective
function extractStopsFromWareneingangsbeleg(
	data: WareneingangselegData,
): Partial<StopExtraction>[] {
	const palletsReceived: PalletMovement[] = [];
	const palletsGiven: PalletMovement[] = [];

	for (const exchange of data.palletExchange) {
		if (exchange.received > 0) {
			palletsGiven.push({
				palletType: exchange.palletType,
				quantity: exchange.received,
			});
		}
		if (exchange.returned > 0) {
			palletsReceived.push({
				palletType: exchange.palletType,
				quantity: exchange.returned,
			});
		}
	}

	return [
		{
			locationType: "delivery",
			locationName: "__DELIVERY_LOCATION__",
			date: data.date,
			palletsReceived,
			palletsGiven,
			exchanged: palletsReceived.length > 0 && palletsGiven.length > 0,
			notes: data.notes,
		},
	];
}

// Ladeliste shows pickup location (Beladeort) and pallets loaded
function extractStopsFromLadeliste(
	data: LadelisteData,
): Partial<StopExtraction>[] {
	const stops: Partial<StopExtraction>[] = [];

	if (data.beladeort && (data.beladeort.name || data.beladeort.address)) {
		stops.push({
			locationType: "pickup" as const,
			locationName: data.beladeort.name || "Pickup Location",
			locationAddress: data.beladeort.address,
			date: data.pickupDate || data.date,
			palletsReceived: data.totalPallets || [],
			palletsGiven: [],
			notes: data.handwrittenNotes,
		});
	} else if (data.stops.length > 0) {
		const firstStop = data.stops[0];
		stops.push({
			locationType: "pickup" as const,
			locationName: firstStop.customerName || `Pickup ${firstStop.stopNumber}`,
			locationAddress: firstStop.address,
			date: data.pickupDate || data.date,
			palletsReceived:
				firstStop.pallets.length > 0
					? firstStop.pallets
					: data.totalPallets || [],
			palletsGiven: [],
			notes: data.handwrittenNotes,
		});
	} else if (data.totalPallets && data.totalPallets.length > 0) {
		stops.push({
			locationType: "pickup" as const,
			locationName: "Unknown Pickup Location",
			date: data.pickupDate || data.date,
			palletsReceived: data.totalPallets,
			palletsGiven: [],
			notes: data.handwrittenNotes,
		});
	}

	return stops;
}

export async function correlateDocuments(
	pages: PDFPage[],
	sourceFile: string,
): Promise<DeliveryExtraction> {
	const processedPages: DocumentPage[] = [];
	const allWarnings: string[] = [];
	let totalConfidence = 0;

	const references: DeliveryExtraction["references"] = {};
	const allStops: Partial<StopExtraction>[] = [];
	let shipper: string | undefined;
	let carrier: string | undefined;
	let consignee: string | undefined;
	let consigneeAddress: string | undefined;
	let vehiclePlate: string | undefined;
	let driverName: string | undefined;

	for (const page of pages) {
		try {
			const { classification, extraction, documentPage } =
				await processPage(page);
			processedPages.push(documentPage);
			totalConfidence += extraction.confidence;

			if (extraction.warnings) {
				allWarnings.push(...extraction.warnings);
			}

			for (const orderNum of classification.identifiers.orderNumbers) {
				if (!references.orderNumber) {
					references.orderNumber = orderNum;
				} else if (
					!references.deliveryNumber &&
					orderNum !== references.orderNumber
				) {
					references.deliveryNumber = orderNum;
				}
			}

			if (extraction.success && extraction.data) {
				switch (classification.documentType) {
					case "lieferschein": {
						const data = extraction.data as LieferscheinData;
						references.orderNumber =
							references.orderNumber || data.stammnummer || data.belegnummer;
						references.tourNumber = references.tourNumber || data.tour;
						shipper = shipper || data.sender?.name;
						consignee = consignee || data.recipient?.name;
						consigneeAddress = consigneeAddress || data.recipient?.address;
						allStops.push(...extractStopsFromLieferschein(data));
						break;
					}
					case "palettennachweis": {
						const data = extraction.data as PalettennachweisData;
						allStops.push(...extractStopsFromPalettennachweis(data));
						break;
					}
					case "wareneingangsbeleg": {
						const data = extraction.data as WareneingangselegData;
						references.deliveryNumber =
							references.deliveryNumber || data.deliveryNumber;
						allStops.push(...extractStopsFromWareneingangsbeleg(data));
						break;
					}
					case "ladeliste": {
						const data = extraction.data as LadelisteData;
						references.tourNumber = references.tourNumber || data.tour;
						vehiclePlate = vehiclePlate || data.vehiclePlate;
						driverName = driverName || data.driver;
						allStops.push(...extractStopsFromLadeliste(data));
						break;
					}
				}
			}
		} catch (error) {
			allWarnings.push(`Failed to process page ${page.pageNumber}: ${error}`);
		}
	}

	for (const stop of allStops) {
		if (stop.locationName === "__DELIVERY_LOCATION__") {
			if (consignee) {
				stop.locationName = consignee;
				stop.locationAddress = consigneeAddress;
			} else {
				stop.locationName = "Unknown Delivery Location";
				allWarnings.push("Delivery location not found in Lieferschein");
			}
		}
	}

	const hasPickupStops = allStops.some((s) => s.locationType === "pickup");
	const hasDeliveryStops = allStops.some((s) => s.locationType === "delivery");

	let lieferDatum: string | undefined;
	let lieferscheinPallets: PalletMovement[] = [];
	for (const page of processedPages) {
		if (page.documentType === "lieferschein" && page.rawExtraction) {
			const lieferscheinData = page.rawExtraction as LieferscheinData;
			lieferDatum = lieferDatum || lieferscheinData.lieferdatum;
			if (
				lieferscheinData.palletInfo &&
				lieferscheinData.palletInfo.length > 0
			) {
				lieferscheinPallets = lieferscheinData.palletInfo;
			}
		}
	}

	if (hasPickupStops && !hasDeliveryStops && consignee) {
		const pickupPallets = allStops
			.filter((s) => s.locationType === "pickup")
			.flatMap((s) => s.palletsReceived || []);

		const deliveryPallets =
			pickupPallets.length > 0 ? pickupPallets : lieferscheinPallets;

		if (deliveryPallets.length > 0 || consignee) {
			allStops.push({
				locationType: "delivery",
				locationName: consignee,
				locationAddress: consigneeAddress,
				date: lieferDatum,
				palletsReceived: deliveryPallets.map((p) => ({ ...p })),
				palletsGiven: deliveryPallets.map((p) => ({ ...p })),
				exchanged: true,
			});
			allWarnings.push(
				"No wareneingangsbeleg found. Created delivery stop from Lieferschein consignee. Pallet exchange assumed (deliveryReceived = deliveryGiven).",
			);
		}
	}

	if (allStops.length === 0 && consignee) {
		let totalPallets: PalletMovement[] = [];
		let ladelisteDate: string | undefined;

		for (const page of processedPages) {
			if (page.documentType === "ladeliste" && page.rawExtraction) {
				const ladelisteData = page.rawExtraction as LadelisteData;
				if (
					ladelisteData.totalPallets &&
					ladelisteData.totalPallets.length > 0
				) {
					totalPallets = ladelisteData.totalPallets;
					ladelisteDate = ladelisteData.date;
					break;
				}
			}
		}

		const palletsToUse =
			totalPallets.length > 0 ? totalPallets : lieferscheinPallets;
		const dateToUse = ladelisteDate || lieferDatum;

		if (palletsToUse.length > 0) {
			allStops.push({
				locationType: "delivery",
				locationName: consignee,
				locationAddress: consigneeAddress,
				date: dateToUse,
				palletsReceived: [],
				palletsGiven: palletsToUse,
				exchanged: false,
			});
			allWarnings.push(
				"No palettennachweis, wareneingangsbeleg, or ladeliste stops found. Created minimal delivery stop.",
			);
		}
	}

	const mergedStops = mergeStops(allStops);
	const avgConfidence =
		processedPages.length > 0 ? totalConfidence / processedPages.length : 0;

	return {
		references,
		shipper,
		carrier,
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

function mergeStops(stops: Partial<StopExtraction>[]): StopExtraction[] {
	const locationMap = new Map<string, StopExtraction>();

	for (const stop of stops) {
		const key = stop.locationName?.toLowerCase() || "unknown";

		const existing = locationMap.get(key);
		if (existing) {
			existing.palletsReceived = mergePalletMovements([
				...existing.palletsReceived,
				...(stop.palletsReceived || []),
			]);
			existing.palletsGiven = mergePalletMovements([
				...existing.palletsGiven,
				...(stop.palletsGiven || []),
			]);

			existing.date = existing.date || stop.date;
			existing.time = existing.time || stop.time;
			existing.locationAddress =
				existing.locationAddress || stop.locationAddress;
			existing.exchanged = existing.exchanged || stop.exchanged || false;

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
			locationMap.set(key, {
				locationType: stop.locationType || "delivery",
				locationName: stop.locationName || "Unknown",
				locationAddress: stop.locationAddress,
				date: stop.date,
				time: stop.time,
				palletsReceived: stop.palletsReceived || [],
				palletsGiven: stop.palletsGiven || [],
				exchanged: stop.exchanged || false,
				signatures: stop.signatures,
				notes: stop.notes,
			});
		}
	}

	return Array.from(locationMap.values());
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
