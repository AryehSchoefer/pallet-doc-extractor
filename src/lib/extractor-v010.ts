import { V010_EXTRACTION_PROMPT } from "../prompts/v010.js";
import type {
	DocumentGroup,
	GroupExtractionResult,
	V010DocumentSubtype,
	V010DocumentType,
	V010ExtractionData,
	V010LocationType,
	V010NonExchangeReason,
	V010PalletMovement,
	V010PalletType,
	V010Perspective,
} from "../types/index.js";
import {
	analyzeMultipleImages,
	parseJSONResponse,
	withRetry,
} from "./ai-client.js";

interface RawV010Response {
	documentType: string;
	documentSubtypes?: string[];
	perspective: string;
	locationType: string;
	location: {
		name: string | null;
		warehouseId?: string | null;
		address: string | null;
	};
	pickupLocation?: {
		name: string | null;
		warehouseId?: string | null;
		address: string | null;
	} | null;
	carrier: {
		name: string | null;
		subCarrier?: string | null;
		driverName?: string | null;
		driverCode?: string | null;
		vehicleNumber?: string | null;
		licensePlate?: string | null;
	};
	shipper?: {
		name: string | null;
	} | null;
	date: string | null;
	palletsGiven: Array<{
		type: string;
		qty: number;
		damaged?: number;
		reason?: string;
	}>;
	palletsReceived: Array<{
		type: string;
		qty: number;
		damaged?: number;
		reason?: string;
	}>;
	palletsReturned?: Array<{ type: string; qty: number; reason?: string }>;
	palletsLoadedOriginal?: Array<{ type: string; qty: number }>;
	references: string[];
	exchanged: boolean | null;
	exchangeExplicit?: boolean | null;
	exchangeComment?: string | null;
	nonExchangeReason?: string | null;
	dplVoucherNumber?: string | null;
	dplIssued?: boolean;
	goodsPartiallyRefused?: boolean;
	goodsAcceptedUnderReservation?: boolean;
	palletsDamaged?: boolean;
	damageNotes?: string | null;
	refusalReasons?: string[];
	saldo?: number | null;
	confidence: number;
	extractionNotes?: string | null;
}

const VALID_DOCUMENT_TYPES: V010DocumentType[] = [
	"lieferschein",
	"lieferanweisung",
	"ladeliste",
	"ladeschein",
	"palettenschein",
	"palettennachweis",
	"wareneingangsbeleg",
	"we_beleg",
	"wareneingangsbestaetigung",
	"dpl_gutschrift",
	"desadv",
	"rueckladeschein",
	"europalettenschein",
	"speditions_auftrag",
	"speditions_uebergabeschein",
	"palettenbewegung",
	"mixed",
	"unknown",
];

const VALID_SUBTYPES: V010DocumentSubtype[] = [
	"ladeliste",
	"ladeschein",
	"lieferschein",
	"speditions_auftrag",
	"wareneingangsbestaetigung",
	"palettenbewegung",
	"dpl_gutschrift",
	"desadv",
];

function normalizeDocumentType(type: string): V010DocumentType {
	const normalized = type.toLowerCase().trim();
	if (VALID_DOCUMENT_TYPES.includes(normalized as V010DocumentType)) {
		return normalized as V010DocumentType;
	}
	return "unknown";
}

function normalizeDocumentSubtypes(
	subtypes: string[] | undefined,
): V010DocumentSubtype[] {
	if (!subtypes) return [];
	return subtypes
		.map((s) => s.toLowerCase().trim())
		.filter((s) =>
			VALID_SUBTYPES.includes(s as V010DocumentSubtype),
		) as V010DocumentSubtype[];
}

function normalizePerspective(perspective: string): V010Perspective {
	const normalized = perspective.toLowerCase().trim();
	if (
		["carrier", "location", "shipper", "pool_operator"].includes(normalized)
	) {
		return normalized as V010Perspective;
	}
	return "carrier";
}

function normalizeLocationType(locationType: string): V010LocationType {
	const normalized = locationType.toLowerCase().trim();
	if (["pickup", "delivery", "handoff"].includes(normalized)) {
		return normalized as V010LocationType;
	}
	return "delivery";
}

function normalizePalletType(type: string): V010PalletType {
	const normalized = type.toLowerCase().trim();

	if (normalized === "eur-nt" || normalized.includes("nicht tausch")) {
		return "EUR-NT";
	}
	if (
		normalized.includes("eur") ||
		normalized.includes("euro") ||
		normalized === "ep"
	) {
		return "EUR";
	}
	if (normalized.includes("einweg")) {
		return "Einweg";
	}
	if (
		normalized.includes("düss") ||
		normalized.includes("duss") ||
		normalized === "dd" ||
		normalized.includes("halbpal")
	) {
		return "Düsseldorfer";
	}
	if (normalized.includes("chep-halb") || normalized.includes("chep halb")) {
		return "CHEP-HALB";
	}
	if (
		normalized.includes("chep-viertel") ||
		normalized.includes("chep viertel")
	) {
		return "CHEP-VIERTEL";
	}
	if (normalized.includes("chep")) {
		return "CHEP";
	}
	if (normalized.includes("gitter") || normalized === "gb") {
		return "Gitterbox";
	}
	if (normalized.includes("plastik") || normalized.includes("kunststoff")) {
		return "Plastik";
	}
	if (normalized === "h1") {
		return "H1";
	}
	if (normalized.includes("roll")) {
		return "Rollcontainer";
	}
	if (normalized.includes("industrie")) {
		return "Industrie";
	}

	return "unknown";
}

function normalizePalletMovements(
	movements:
		| Array<{ type: string; qty: number; damaged?: number; reason?: string }>
		| undefined,
): V010PalletMovement[] {
	if (!movements) return [];
	return movements
		.filter((m) => m.qty > 0)
		.map((m) => ({
			type: normalizePalletType(m.type),
			qty: m.qty,
			...(m.damaged ? { damaged: m.damaged } : {}),
			...(m.reason ? { reason: m.reason } : {}),
		}));
}

function normalizeNonExchangeReason(
	reason: string | null | undefined,
): V010NonExchangeReason {
	if (!reason) return null;
	const normalized = reason.toLowerCase().trim();
	if (normalized === "driver_refused") return "driver_refused";
	if (normalized === "no_pallets_available") return "no_pallets_available";
	if (normalized === "goods_refused") return "goods_refused";
	return null;
}

function normalizeExtraction(raw: RawV010Response): V010ExtractionData {
	return {
		documentType: normalizeDocumentType(raw.documentType),
		documentSubtypes: normalizeDocumentSubtypes(raw.documentSubtypes),
		perspective: normalizePerspective(raw.perspective),
		locationType: normalizeLocationType(raw.locationType),
		location: {
			name: raw.location?.name ?? null,
			warehouseId: raw.location?.warehouseId ?? null,
			address: raw.location?.address ?? null,
		},
		pickupLocation: raw.pickupLocation
			? {
					name: raw.pickupLocation.name ?? null,
					warehouseId: raw.pickupLocation.warehouseId ?? null,
					address: raw.pickupLocation.address ?? null,
				}
			: null,
		carrier: {
			name: raw.carrier?.name ?? null,
			subCarrier: raw.carrier?.subCarrier ?? null,
			driverName: raw.carrier?.driverName ?? null,
			driverCode: raw.carrier?.driverCode ?? null,
			vehicleNumber: raw.carrier?.vehicleNumber ?? null,
			licensePlate: raw.carrier?.licensePlate ?? null,
		},
		shipper: raw.shipper ? { name: raw.shipper.name ?? null } : null,
		date: raw.date ?? null,
		palletsGiven: normalizePalletMovements(raw.palletsGiven),
		palletsReceived: normalizePalletMovements(raw.palletsReceived),
		palletsReturned: normalizePalletMovements(raw.palletsReturned),
		palletsLoadedOriginal: normalizePalletMovements(raw.palletsLoadedOriginal),
		references: raw.references ?? [],
		exchanged: raw.exchanged ?? null,
		exchangeExplicit: raw.exchangeExplicit ?? null,
		exchangeComment: raw.exchangeComment ?? null,
		nonExchangeReason: normalizeNonExchangeReason(raw.nonExchangeReason),
		dplVoucherNumber: raw.dplVoucherNumber ?? null,
		dplIssued: raw.dplIssued ?? false,
		goodsPartiallyRefused: raw.goodsPartiallyRefused ?? false,
		goodsAcceptedUnderReservation: raw.goodsAcceptedUnderReservation ?? false,
		palletsDamaged: raw.palletsDamaged ?? false,
		damageNotes: raw.damageNotes ?? null,
		refusalReasons: raw.refusalReasons ?? [],
		saldo: raw.saldo ?? null,
		confidence: raw.confidence ?? 0.5,
		extractionNotes: raw.extractionNotes ?? null,
	};
}

export async function extractDocumentGroup(
	group: DocumentGroup,
): Promise<GroupExtractionResult> {
	const startTime = Date.now();

	try {
		const images = group.pages.map((p) => p.imageBase64);

		const response = await withRetry(async () => {
			return analyzeMultipleImages(images, V010_EXTRACTION_PROMPT);
		});

		const parsed = parseJSONResponse<RawV010Response | RawV010Response[]>(
			response,
		);

		let data: V010ExtractionData | V010ExtractionData[];
		let needsReview = false;

		if (Array.isArray(parsed)) {
			data = parsed.map(normalizeExtraction);
			needsReview = data.some((d) => d.confidence < 0.7);
		} else {
			data = normalizeExtraction(parsed);
			needsReview = data.confidence < 0.7;
		}

		return {
			group,
			success: true,
			data,
			processingTimeMs: Date.now() - startTime,
			needsReview,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(
			`Failed to extract document group ${group.prefix}:`,
			errorMessage,
		);

		return {
			group,
			success: false,
			error: errorMessage,
			processingTimeMs: Date.now() - startTime,
			needsReview: true,
		};
	}
}
