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
	identifiers: {
		orderNumbers: string[];
		dates: string[];
		companies: string[];
	};
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
