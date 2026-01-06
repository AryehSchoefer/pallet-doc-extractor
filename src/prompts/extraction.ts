import { decodePrompt, env } from "../env.js";

const DEFAULT_EXTRACTION_PROMPT = ``;

export const EXTRACTION_PROMPT =
	decodePrompt(env.EXTRACTION_PROMPT_BASE64) ?? DEFAULT_EXTRACTION_PROMPT;

export function buildExtractionPrompt(documentContext: string): string {
	return EXTRACTION_PROMPT.replace("{{DOCUMENT_CONTEXT}}", documentContext);
}
