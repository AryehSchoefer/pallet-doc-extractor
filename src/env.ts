import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		OPENROUTER_API_KEY: z.string().min(1),
		OPENROUTER_MODEL: z.string().default("google/gemini-2.5-pro"),
		CLASSIFICATION_PROMPT_BASE64: z.string().optional(),
		EXTRACTION_PROMPT_BASE64: z.string().optional(),
		PORT: z.coerce.number().default(3000),
		API_KEY: z.string().min(1),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

export function decodePrompt(
	base64Prompt: string | undefined,
): string | undefined {
	if (!base64Prompt) return undefined;
	return Buffer.from(base64Prompt, "base64").toString("utf-8");
}
