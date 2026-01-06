import { decodePrompt, env } from "../env.js";

const DEFAULT_CLASSIFICATION_PROMPT = ``;

export const CLASSIFICATION_PROMPT =
	decodePrompt(env.CLASSIFICATION_PROMPT_BASE64) ??
	DEFAULT_CLASSIFICATION_PROMPT;
