export type DocumentType =
	| "lieferschein"
	| "ladeliste"
	| "palettennachweis"
	| "wareneingangsbeleg"
	| "unknown";

export type PalletType =
	| "EUR"
	| "Düsseldorfer"
	| "CHEP"
	| "Gitterbox"
	| "unknown";

export type PalletQuality = "A" | "B" | "mixed";

export type LocationType = "pickup" | "delivery";

export interface DocumentPage {
	pageNumber: number;
	documentType: DocumentType;
	confidence: number;
	rawExtraction: unknown;
	imageBase64?: string;
}

export interface PalletMovement {
	palletType: PalletType;
	quantity: number;
	damaged?: number;
	quality?: PalletQuality;
}

export interface StopExtraction {
	locationType: LocationType;
	locationName: string;
	locationAddress?: string;
	date?: string;
	time?: string;
	palletsReceived: PalletMovement[];
	palletsGiven: PalletMovement[];
	exchanged: boolean;
	signatures?: {
		driver?: boolean;
		customer?: boolean;
	};
	notes?: string[];
}

export interface DeliveryExtraction {
	references: {
		orderNumber?: string;
		deliveryNumber?: string;
		tourNumber?: string;
		customerReference?: string;
		sapNumber?: string;
	};
	shipper?: string;
	carrier?: string;
	consignee?: string;
	vehiclePlate?: string;
	driverName?: string;
	stops: StopExtraction[];
	sourceFile: string;
	processedPages: DocumentPage[];
	extractionConfidence: number;
	warnings: string[];
}

export interface LademittelmahnungOutput {
	referenceNumber: string;
	pickup: {
		date: string;
		time?: string;
		location: string;
		address: string;
	};
	delivery: {
		date: string;
		time?: string;
		location: string;
		address: string;
	};
	palletMovements: {
		palletType: string;
		pickupReceived: number;
		pickupGiven: number;
		deliveryGiven: number;
		deliveryReceived: number;
		saldo: number;
	}[];
}

export interface ClassificationResult {
	documentType: DocumentType;
	confidence: number;
	references: string[];
	reasoning?: string;
}

export type Perspective = "carrier" | "location";

export interface V2PalletMovement {
	type: PalletType;
	qty: number;
	damaged?: number;
}

export interface V2ExtractionData {
	documentType: DocumentType;
	perspective: Perspective;
	locationType: LocationType;
	location: {
		name: string | null;
		address: string | null;
	};
	date: string | null;
	palletsGiven: V2PalletMovement[];
	palletsReceived: V2PalletMovement[];
	exchanged: boolean | null;
	references: {
		order: string | null;
		delivery: string | null;
		tour: string | null;
		shipment: string | null;
	};
	parties: {
		sender: { name: string | null; address: string | null };
		recipient: { name: string | null; address: string | null };
	};
	signatures: {
		driver: boolean;
		customer: boolean;
	};
	notes: string[];
	confidence: number;
	warnings: string[];
}

export interface ExtractionResult<T = unknown> {
	success: boolean;
	data?: T;
	confidence: number;
	warnings: string[];
	rawResponse?: string;
}

export interface LieferscheinData {
	stammnummer?: string;
	belegnummer?: string;
	tour?: string;
	bestelldatum?: string;
	lieferdatum?: string;
	sender: {
		name?: string;
		address?: string;
	};
	recipient: {
		name?: string;
		address?: string;
	};
	items?: Array<{
		description: string;
		quantity: number;
		unit: string;
	}>;
	palletInfo?: PalletMovement[];
	corrections?: PalletMovement[];
}

export interface PalettennachweisData {
	date?: string;
	location?: string;
	fromCompany?: string;
	toCompany?: string;
	palletsGiven: PalletMovement[];
	palletsReceived: PalletMovement[];
	reason?: string;
	signatures: {
		driver?: boolean;
		customer?: boolean;
	};
	notes?: string[];
}

export interface WareneingangselegData {
	date?: string;
	receiptNumber?: string;
	deliveryNumber?: string;
	supplier?: string;
	palletExchange: Array<{
		palletType: PalletType;
		received: number;
		returned: number;
		saldo: number;
	}>;
	confirmed: boolean;
	notes?: string[];
}

export interface LadelisteData {
	tour?: string;
	date?: string;
	pickupDate?: string;
	vehiclePlate?: string;
	driver?: string;
	sendungsnummer?: string;
	beladeort?: {
		name?: string;
		address?: string;
	};
	stops: Array<{
		stopNumber: number;
		customerName?: string;
		address?: string;
		pallets: PalletMovement[];
	}>;
	totalPallets?: PalletMovement[];
	handwrittenNotes?: string[];
	pallettenNichtGetauscht?: boolean;
}

export interface BatchProcessingResult {
	inputFile: string;
	success: boolean;
	extraction?: DeliveryExtraction;
	lademittelmahnung?: LademittelmahnungOutput;
	error?: string;
	processingTimeMs: number;
}

export interface BatchSummary {
	totalFiles: number;
	successCount: number;
	failureCount: number;
	results: BatchProcessingResult[];
}

export interface ExcelRow {
	transportOrderRef: string;
	deliveryRef: string;
	pickupDate: string;
	pickupAddress: string;
	deliveryDate: string;
	deliveryAddress: string;
	palletType: string;
	pickupLoaded: number;
	pickupUnloaded: number;
	deliveryLoaded: number;
	deliveryUnloaded: number;
	damagedNotes: string;
	saldo: number;
}

export interface PDFPage {
	pageNumber: number;
	imageBase64: string;
	width: number;
	height: number;
}

export interface PDFProcessingResult {
	filePath: string;
	totalPages: number;
	pages: PDFPage[];
}

// ============================================================================
// v0.10 Types - Single-Pass Architecture
// ============================================================================

export type V010DocumentType =
	| "lieferschein"
	| "lieferanweisung"
	| "ladeliste"
	| "ladeschein"
	| "palettenschein"
	| "palettennachweis"
	| "wareneingangsbeleg"
	| "we_beleg"
	| "wareneingangsbestaetigung"
	| "dpl_gutschrift"
	| "desadv"
	| "rueckladeschein"
	| "europalettenschein"
	| "speditions_auftrag"
	| "speditions_uebergabeschein"
	| "palettenbewegung"
	| "mixed"
	| "unknown";

export type V010DocumentSubtype =
	| "ladeliste"
	| "ladeschein"
	| "lieferschein"
	| "speditions_auftrag"
	| "wareneingangsbestaetigung"
	| "palettenbewegung"
	| "dpl_gutschrift"
	| "desadv";

export type V010Perspective =
	| "carrier"
	| "location"
	| "shipper"
	| "pool_operator";

export type V010LocationType = "pickup" | "delivery" | "handoff";

export type V010PalletType =
	| "EUR"
	| "EUR-NT"
	| "Einweg"
	| "Düsseldorfer"
	| "CHEP"
	| "CHEP-HALB"
	| "CHEP-VIERTEL"
	| "Gitterbox"
	| "Plastik"
	| "H1"
	| "Rollcontainer"
	| "Industrie"
	| "unknown";

export interface V010Location {
	name: string | null;
	warehouseId: string | null;
	address: string | null;
}

export interface V010Carrier {
	name: string | null;
	subCarrier: string | null;
	driverName: string | null;
	driverCode: string | null;
	vehicleNumber: string | null;
	licensePlate: string | null;
}

export interface V010Shipper {
	name: string | null;
}

export interface V010PalletMovement {
	type: V010PalletType;
	qty: number;
	damaged?: number;
	reason?: string;
}

export type V010NonExchangeReason =
	| "driver_refused"
	| "no_pallets_available"
	| "goods_refused"
	| null;

export interface V010ExtractionData {
	documentType: V010DocumentType;
	documentSubtypes: V010DocumentSubtype[];
	perspective: V010Perspective;
	locationType: V010LocationType;

	location: V010Location;
	pickupLocation: V010Location | null;
	carrier: V010Carrier;
	shipper: V010Shipper | null;

	date: string | null;
	palletsGiven: V010PalletMovement[];
	palletsReceived: V010PalletMovement[];
	palletsReturned: V010PalletMovement[];
	palletsLoadedOriginal: V010PalletMovement[];

	references: string[];
	exchanged: boolean | null;
	exchangeExplicit: boolean | null;
	exchangeComment: string | null;
	nonExchangeReason: V010NonExchangeReason;

	dplVoucherNumber: string | null;
	dplIssued: boolean;
	goodsPartiallyRefused: boolean;
	goodsAcceptedUnderReservation: boolean;
	palletsDamaged: boolean;
	damageNotes: string | null;
	refusalReasons: string[];

	saldo: number | null;
	confidence: number;
	extractionNotes: string | null;
}

export interface DocumentGroup {
	prefix: string;
	files: string[];
	pages: PDFPage[];
}

export interface GroupExtractionResult {
	group: DocumentGroup;
	success: boolean;
	data?: V010ExtractionData | V010ExtractionData[];
	error?: string;
	processingTimeMs: number;
	needsReview: boolean;
}

export interface V010BatchProcessingResult {
	groupPrefix: string;
	inputFiles: string[];
	success: boolean;
	extractions?: V010ExtractionData[];
	lademittelmahnung?: LademittelmahnungOutput[];
	error?: string;
	processingTimeMs: number;
	needsReview: boolean;
}

export interface V010BatchSummary {
	totalGroups: number;
	totalFiles: number;
	successCount: number;
	failureCount: number;
	needsReviewCount: number;
	results: V010BatchProcessingResult[];
}
