export type ProfileChangeSource = "model" | "user";

export type SessionEvent =
	| { type: "start" }
	| { type: "text_delta"; delta: string }
	| { type: "message_end" }
	| { type: "tool_start"; toolName: string; args: unknown }
	| { type: "tool_end"; toolName: string; isError: boolean; text: string }
	| { type: "profile"; profile: string | null; name: string | null; source: ProfileChangeSource }
	| { type: "toolset"; toolset: string; active: boolean }
	| { type: "error"; message: string }
	| { type: "done"; errorMessage?: string };
