import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as XLSX from "xlsx";
import type {
	DeliveryExtraction,
	ExcelRow,
	LademittelmahnungOutput,
	PalletMovement,
	StopExtraction,
	V010ExtractionData,
	V010PalletMovement,
} from "../types/index.js";

function parseDateToNumber(dateStr: string | undefined): number {
	if (!dateStr) return 0;

	const match = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
	if (!match) return 0;

	const day = parseInt(match[1], 10);
	const month = parseInt(match[2], 10);
	let year = parseInt(match[3], 10);

	if (year < 100) {
		year += year < 50 ? 2000 : 1900;
	}

	return year * 10000 + month * 100 + day;
}

function determinePickupAndDelivery(extraction: DeliveryExtraction): {
	pickup: StopExtraction | undefined;
	delivery: StopExtraction | undefined;
} {
	const stops = extraction.stops;

	if (stops.length === 0) {
		return { pickup: undefined, delivery: undefined };
	}

	let pickupStop = stops.find((s) => s.locationType === "pickup");
	let deliveryStop = stops.find((s) => s.locationType === "delivery");

	if (pickupStop && deliveryStop && pickupStop !== deliveryStop) {
		return { pickup: pickupStop, delivery: deliveryStop };
	}

	if (!pickupStop || !deliveryStop) {
		const sortedStops = [...stops].sort(
			(a, b) => parseDateToNumber(a.date) - parseDateToNumber(b.date),
		);

		if (!pickupStop && sortedStops.length > 0) {
			for (const stop of sortedStops) {
				if (stop !== deliveryStop) {
					pickupStop = stop;
					break;
				}
			}
		}

		if (!deliveryStop && sortedStops.length > 0) {
			for (let i = sortedStops.length - 1; i >= 0; i--) {
				if (sortedStops[i] !== pickupStop) {
					deliveryStop = sortedStops[i];
					break;
				}
			}
		}
	}

	if (!pickupStop || !deliveryStop || pickupStop === deliveryStop) {
		for (const stop of stops) {
			const totalReceived = stop.palletsReceived.reduce(
				(sum, p) => sum + p.quantity,
				0,
			);
			const totalGiven = stop.palletsGiven.reduce(
				(sum, p) => sum + p.quantity,
				0,
			);

			if (
				totalReceived > totalGiven &&
				(!pickupStop || stop !== deliveryStop)
			) {
				pickupStop = stop;
			} else if (totalGiven > 0 && (!deliveryStop || stop !== pickupStop)) {
				deliveryStop = stop;
			}
		}
	}

	if (stops.length === 1) {
		const stop = stops[0];
		const hasReceived = stop.palletsReceived.some((p) => p.quantity > 0);
		const hasGiven = stop.palletsGiven.some((p) => p.quantity > 0);

		if (hasReceived && !hasGiven) {
			return { pickup: stop, delivery: undefined };
		} else if (hasGiven) {
			return { pickup: undefined, delivery: stop };
		}
	}

	return { pickup: pickupStop, delivery: deliveryStop };
}

export function toLademittelmahnungFormat(
	extraction: DeliveryExtraction,
): LademittelmahnungOutput | null {
	const { pickup: effectivePickup, delivery: effectiveDelivery } =
		determinePickupAndDelivery(extraction);

	if (!effectivePickup && !effectiveDelivery) {
		return null;
	}

	const palletTypes = new Set<string>();
	for (const stop of extraction.stops) {
		for (const movement of [...stop.palletsReceived, ...stop.palletsGiven]) {
			palletTypes.add(movement.palletType);
		}
	}

	const palletMovements: LademittelmahnungOutput["palletMovements"] = [];

	for (const palletType of palletTypes) {
		const pickupReceived = sumPallets(
			effectivePickup?.palletsReceived || [],
			palletType,
		);
		const pickupGiven = sumPallets(
			effectivePickup?.palletsGiven || [],
			palletType,
		);
		const deliveryGiven = sumPallets(
			effectiveDelivery?.palletsGiven || [],
			palletType,
		);
		const deliveryReceived = sumPallets(
			effectiveDelivery?.palletsReceived || [],
			palletType,
		);

		// Saldo = carrier's debt to pallet pool (pickup only, delivery exchange doesn't offset)
		const saldo = pickupGiven - pickupReceived;

		if (
			pickupReceived > 0 ||
			pickupGiven > 0 ||
			deliveryGiven > 0 ||
			deliveryReceived > 0
		) {
			palletMovements.push({
				palletType,
				pickupReceived,
				pickupGiven,
				deliveryGiven,
				deliveryReceived,
				saldo,
			});
		}
	}

	return {
		referenceNumber:
			extraction.references.orderNumber ||
			extraction.references.deliveryNumber ||
			extraction.references.tourNumber ||
			"UNKNOWN",
		pickup: {
			date: effectivePickup?.date || "N/A",
			time: effectivePickup?.time,
			location: effectivePickup?.locationName || "N/A",
			address: effectivePickup?.locationAddress || "N/A",
		},
		delivery: {
			date: effectiveDelivery?.date || "N/A",
			time: effectiveDelivery?.time,
			location: effectiveDelivery?.locationName || "N/A",
			address: effectiveDelivery?.locationAddress || "N/A",
		},
		palletMovements,
	};
}

function sumPallets(movements: PalletMovement[], palletType: string): number {
	return movements
		.filter((m) => m.palletType === palletType)
		.reduce((sum, m) => sum + m.quantity, 0);
}

function sumV010Pallets(
	movements: V010PalletMovement[],
	palletType: string,
): number {
	return movements
		.filter((m) => m.type === palletType)
		.reduce((sum, m) => sum + m.qty, 0);
}

/**
 * Convert V010ExtractionData to LademittelmahnungOutput format.
 * Handles the new v0.10 schema with carrier perspective.
 */
export function v010ToLademittelmahnungFormat(
	extraction: V010ExtractionData,
): LademittelmahnungOutput {
	const palletTypes = new Set<string>();
	for (const movement of [
		...extraction.palletsGiven,
		...extraction.palletsReceived,
	]) {
		palletTypes.add(movement.type);
	}

	const palletMovements: LademittelmahnungOutput["palletMovements"] = [];

	for (const palletType of palletTypes) {
		const given = sumV010Pallets(extraction.palletsGiven, palletType);
		const received = sumV010Pallets(extraction.palletsReceived, palletType);
		const saldo = given - received;

		if (given > 0 || received > 0) {
			if (extraction.locationType === "pickup") {
				palletMovements.push({
					palletType,
					pickupReceived: given,
					pickupGiven: received,
					deliveryGiven: 0,
					deliveryReceived: 0,
					saldo,
				});
			} else {
				palletMovements.push({
					palletType,
					pickupReceived: 0,
					pickupGiven: 0,
					deliveryGiven: given,
					deliveryReceived: received,
					saldo,
				});
			}
		}
	}

	const referenceNumber = extraction.references[0] || "UNKNOWN";

	const locationInfo = {
		date: extraction.date || "N/A",
		time: undefined,
		location: extraction.location.name || "N/A",
		address: extraction.location.address || "N/A",
	};

	const pickupInfo = extraction.pickupLocation
		? {
				date: extraction.date || "N/A",
				time: undefined,
				location: extraction.pickupLocation.name || "N/A",
				address: extraction.pickupLocation.address || "N/A",
			}
		: {
				date: "N/A",
				time: undefined,
				location: "N/A",
				address: "N/A",
			};

	return {
		referenceNumber,
		pickup: extraction.locationType === "pickup" ? locationInfo : pickupInfo,
		delivery:
			extraction.locationType === "delivery"
				? locationInfo
				: {
						date: "N/A",
						time: undefined,
						location: "N/A",
						address: "N/A",
					},
		palletMovements,
	};
}

/**
 * Convert multiple V010 extractions to LademittelmahnungOutput array.
 */
export function v010BatchToLademittelmahnungFormat(
	extractions: V010ExtractionData[],
): LademittelmahnungOutput[] {
	return extractions.map(v010ToLademittelmahnungFormat);
}

export function toExcelRows(output: LademittelmahnungOutput): ExcelRow[] {
	const rows: ExcelRow[] = [];

	for (const movement of output.palletMovements) {
		rows.push({
			transportOrderRef: output.referenceNumber,
			deliveryRef: output.referenceNumber,
			pickupDate: output.pickup.date,
			pickupAddress: `${output.pickup.location}, ${output.pickup.address}`,
			deliveryDate: output.delivery.date,
			deliveryAddress: `${output.delivery.location}, ${output.delivery.address}`,
			palletType: movement.palletType,
			pickupLoaded: movement.pickupReceived,
			pickupUnloaded: movement.pickupGiven,
			deliveryLoaded: movement.deliveryReceived,
			deliveryUnloaded: movement.deliveryGiven,
			damagedNotes: "",
			saldo: movement.saldo,
		});
	}

	return rows;
}

export async function saveAsJSON(
	data: unknown,
	outputPath: string,
): Promise<void> {
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf-8");
	console.log(`Saved JSON to ${outputPath}`);
}

export async function generateExcel(
	results: LademittelmahnungOutput[],
	outputPath: string,
): Promise<void> {
	const allRows: ExcelRow[] = [];

	for (const result of results) {
		allRows.push(...toExcelRows(result));
	}

	const workbook = XLSX.utils.book_new();

	const headers = [
		"Transport Order Ref",
		"Delivery Ref",
		"Pickup Date",
		"Pickup Address",
		"Delivery Date",
		"Delivery Address",
		"Pallet Type",
		"Pickup Loaded",
		"Pickup Unloaded",
		"Delivery Loaded",
		"Delivery Unloaded",
		"Damaged Notes",
		"Saldo",
	];

	const data = allRows.map((row) => [
		row.transportOrderRef,
		row.deliveryRef,
		row.pickupDate,
		row.pickupAddress,
		row.deliveryDate,
		row.deliveryAddress,
		row.palletType,
		row.pickupLoaded,
		row.pickupUnloaded,
		row.deliveryLoaded,
		row.deliveryUnloaded,
		row.damagedNotes,
		row.saldo,
	]);

	const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);

	worksheet["!cols"] = [
		{ wch: 20 },
		{ wch: 20 },
		{ wch: 12 },
		{ wch: 40 },
		{ wch: 12 },
		{ wch: 40 },
		{ wch: 15 },
		{ wch: 14 },
		{ wch: 16 },
		{ wch: 16 },
		{ wch: 18 },
		{ wch: 20 },
		{ wch: 10 },
	];

	XLSX.utils.book_append_sheet(workbook, worksheet, "Lademittelmahnung");

	const summaryData = createSummary(results);
	const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
	XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	XLSX.writeFile(workbook, outputPath);
	console.log(`Generated Excel file: ${outputPath}`);
}

function createSummary(
	results: LademittelmahnungOutput[],
): (string | number)[][] {
	const summary: (string | number)[][] = [
		["Pallet Movement Summary"],
		[],
		[
			"Pallet Type",
			"Total Pickup Loaded",
			"Total Pickup Unloaded",
			"Total Delivery Loaded",
			"Total Delivery Unloaded",
			"Total Saldo",
		],
	];

	const totals = new Map<
		string,
		{
			pickupLoaded: number;
			pickupUnloaded: number;
			deliveryLoaded: number;
			deliveryUnloaded: number;
			saldo: number;
		}
	>();

	for (const result of results) {
		for (const movement of result.palletMovements) {
			if (!totals.has(movement.palletType)) {
				totals.set(movement.palletType, {
					pickupLoaded: 0,
					pickupUnloaded: 0,
					deliveryLoaded: 0,
					deliveryUnloaded: 0,
					saldo: 0,
				});
			}
			const t = totals.get(movement.palletType);
			if (!t) continue;
			t.pickupLoaded += movement.pickupReceived;
			t.pickupUnloaded += movement.pickupGiven;
			t.deliveryLoaded += movement.deliveryReceived;
			t.deliveryUnloaded += movement.deliveryGiven;
			t.saldo += movement.saldo;
		}
	}

	for (const [palletType, t] of totals) {
		summary.push([
			palletType,
			t.pickupLoaded,
			t.pickupUnloaded,
			t.deliveryLoaded,
			t.deliveryUnloaded,
			t.saldo,
		]);
	}

	summary.push([]);
	summary.push(["Total Documents Processed", results.length]);

	return summary;
}

export async function loadJSONResults(
	dirPath: string,
): Promise<LademittelmahnungOutput[]> {
	const results: LademittelmahnungOutput[] = [];
	const absolutePath = path.resolve(dirPath);

	const entries = await fs.readdir(absolutePath, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith(".json")) {
			const filePath = path.join(absolutePath, entry.name);
			const content = await fs.readFile(filePath, "utf-8");
			try {
				const data = JSON.parse(content);
				if (
					data.referenceNumber &&
					data.pickup &&
					data.delivery &&
					data.palletMovements
				) {
					results.push(data as LademittelmahnungOutput);
				}
			} catch (error) {
				console.warn(`Failed to parse ${entry.name}: ${error}`);
			}
		}
	}

	return results;
}
