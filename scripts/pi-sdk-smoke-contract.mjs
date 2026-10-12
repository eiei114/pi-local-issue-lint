export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension/i;

export function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

function commandRegistration(responses) {
  const response = responses.find((row) => row?.type === "response" && row.command === "get_commands");
  const command = response?.data?.commands?.find((item) => item.name === "local-issue-lint:check");
  return { response: response ?? null, command: command ?? null };
}

function registrationObservation(registration) {
  return {
    success: registration.response?.success ?? false,
    command: registration.command?.name ?? null,
    source: registration.command?.source ?? null,
  };
}

function registeredTools(responses) {
  return responses.flatMap((row) => row?.type === "agent_end"
    ? row.messages?.filter((message) => message.role === "system").flatMap((message) => message.toolsAdded ?? []).map((tool) => tool.name) ?? []
    : []);
}

function toolResult(responses) {
  return responses.find((row) => row?.type === "tool_execution_end" && row.toolName === "local_issue_lint");
}

function toolObservation(execution) {
  const details = execution?.result?.details;
  return {
    isError: execution?.isError ?? null,
    details: details ? {
      ok: details.ok,
      summary: details.summary,
      findings: details.findings?.map(({ code, severity, message }) => ({ code, severity, message })) ?? [],
    } : null,
  };
}

function finalMarker(responses) {
  return responses.some((row) => row?.type === "message_end" && row.message?.role === "assistant"
    && row.message.content?.some((part) => part.type === "text" && part.text === "PI_LINT_SMOKE_COMPLETE"));
}

function featureSucceeded(responses) {
  const execution = toolResult(responses);
  const details = execution?.result?.details;
  return execution?.isError === false && details?.ok === true && details.summary?.scanned === 1
    && details.summary?.errors === 0 && Array.isArray(details.findings) && details.findings.length === 0
    && finalMarker(responses);
}

export function behaviorAssertions(name, { responses, fullOutput, exit_code, process_exited, expectedVersion }) {
  const registration = commandRegistration(responses);
  const execution = toolResult(responses);
  const feature = featureSucceeded(responses);
  if (name === "extension_load") {
    const tools = registeredTools(responses);
    return [assertion("extension_registered", "The real Pi host registers the package slash command",
      { ...registrationObservation(registration), tools }, registration.response?.success === true
        && registration.command?.source === "extension" && tools.includes("local_issue_lint"))];
  }
  if (name === "happy_path") {
    return [assertion("feature_response", "The actual Pi host executes local_issue_lint on a valid file and returns the successful lint result",
      toolObservation(execution), feature)];
  }
  if (name === "error_path") {
    const details = execution?.result?.details;
    const missingTarget = details?.findings?.find((item) => item.code === "TARGET_NOT_FOUND");
    const handled = execution?.isError === false && details?.ok === false && details.summary?.errors === 1
      && missingTarget !== undefined && finalMarker(responses);
    return [assertion("handled_error", "A missing target returns the documented TARGET_NOT_FOUND lint finding without an unhandled tool error",
      toolObservation(execution), handled)];
  }
  if (name === "reload_cleanup") {
    return [
      assertion("reloaded_extension_registered", "A fresh second Pi host registers the package slash command",
        registrationObservation(registration), registration.response?.success === true && registration.command?.source === "extension"),
      assertion("reloaded_feature_response", "The second host executes the lint feature and returns the actual successful result",
        toolObservation(execution), feature),
      assertion("clean_shutdown", "Both actual Pi processes exit zero without runtime errors",
        { exit_code, process_exited, errors: UNHANDLED_ERROR_PATTERN.test(fullOutput) },
        exit_code === 0 && process_exited && !UNHANDLED_ERROR_PATTERN.test(fullOutput)),
    ];
  }
  if (name === "host_shell") {
    return [assertion("native_shell_boundary", "The native host shell launches the locally pinned Pi CLI and returns its exact version",
      { exit_code, process_exited, output: fullOutput.trim(), expectedVersion },
      exit_code === 0 && process_exited && fullOutput.trim() === expectedVersion)];
  }
  throw new Error(`Unknown smoke case: ${name}`);
}
