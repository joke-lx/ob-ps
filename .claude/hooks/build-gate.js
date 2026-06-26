#!/usr/bin/env node
// PostToolUse gate for ob-ps: injects the obsidian-plugin-review prompt ONLY when the
// preceding Bash command was a build / lint / type-check / test invocation. For every
// other command it prints nothing and exits 0, so the harness stays fully silent
// (no model turn, no "stopped continuation" message).
//
// Invoked by .claude/settings.json -> hooks.PostToolUse[matcher=Bash].
// Reads the hook payload from stdin: { tool_name, tool_input: { command } }.
// Uses async stdin reading and only globals (process, Buffer, JSON) so the script runs
// identically under CommonJS or ESM (this repo is type:module) and reliably on Windows,
// where synchronous readFileSync(fd=0) is flaky across module modes.

const ALLOWED = /^(npm run (build|lint|dev|type-check|check)|(yarn|pnpm) (build|lint|dev)|eslint( |$)|tsc( |$)|vitest( |$)|esbuild( |$))/;

const REVIEW_PROMPT =
	'The preceding Bash command was a build / lint / type-check / test invocation on the ' +
	'ob-ps Obsidian plugin. Invoke the obsidian-plugin-review skill to verify the project ' +
	'still meets Obsidian plugin review standards.';

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
	let payload;
	try {
		payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		process.exit(0); // malformed payload — stay silent
	}
	const command = payload && payload.tool_input && payload.tool_input.command;
	if (typeof command !== 'string' || !ALLOWED.test(command)) {
		process.exit(0); // not a build/lint/type-check/test command — silent pass
	}
	process.stdout.write(
		JSON.stringify({
			hookSpecificOutput: {
				hookEventName: 'PostToolUse',
				additionalContext: REVIEW_PROMPT,
			},
		}),
	);
});
