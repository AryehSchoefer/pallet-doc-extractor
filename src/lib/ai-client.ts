import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type LanguageModel } from "ai";
import "dotenv/config";

const openrouter = createOpenRouter({
	apiKey: process.env.OPENROUTER_API_KEY,
});

// const model: LanguageModel = openrouter("google/gemini-2.0-flash-001");
// const model: LanguageModel = openrouter("google/gemini-3-flash-preview");
// const model: LanguageModel = openrouter("google/gemini-3-pro-preview");
// const model: LanguageModel = openrouter("google/gemini-2.5-pro");
const model: LanguageModel = openrouter("anthropic/claude-opus-4.5");
// const model: LanguageModel = openrouter("z-ai/glm-4.6v");
// const model: LanguageModel = openrouter("openai/gpt-5.1");

export interface AIMessage {
	role: "user" | "assistant" | "system";
	content: AIMessageContent[];
}

export type AIMessageContent =
	| { type: "text"; text: string }
	| { type: "image"; image: string }; // base64 or URL

export async function analyzeImage(
	imageBase64: string,
	prompt: string,
): Promise<string> {
	const { text } = await generateText({
		model,
		messages: [
			{
				role: "user",
				content: [
					{ type: "image", image: imageBase64 },
					{ type: "text", text: prompt },
				],
			},
		],
	});

	return text;
}

export async function analyzeMultipleImages(
	imagesBase64: string[],
	prompt: string,
): Promise<string> {
	const content: AIMessageContent[] = [
		...imagesBase64.map((img) => ({ type: "image" as const, image: img })),
		{ type: "text", text: prompt },
	];

	const { text } = await generateText({
		model,
		messages: [
			{
				role: "user",
				content,
			},
		],
	});

	return text;
}

export function parseJSONResponse<T>(response: string): T {
	let cleaned = response.trim();

	const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (jsonBlockMatch) {
		cleaned = jsonBlockMatch[1].trim();
	}

	const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
	if (jsonMatch) {
		cleaned = jsonMatch[1];
	}

	try {
		return JSON.parse(cleaned) as T;
	} catch (_error) {
		throw new Error(
			`Failed to parse JSON from AI response: ${cleaned.substring(0, 200)}...`,
		);
	}
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	maxRetries: number = 3,
	initialDelayMs: number = 1000,
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.warn(`Attempt ${attempt + 1} failed: ${lastError.message}`);

			if (attempt < maxRetries - 1) {
				const delay = initialDelayMs * 2 ** attempt;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	throw lastError;
}

export { model };
