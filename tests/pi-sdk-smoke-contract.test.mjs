import assert from "node:assert/strict";
import test from "node:test";
import { behaviorAssertions, parseJsonLines, VERIFICATION_CONTRACT } from "../scripts/pi-sdk-smoke-contract.mjs";

const command = { name: "local-issue-lint:check", source: "extension" };
const toolResult = (details, isError = false) => ({
  type: "tool_execution_end",
  toolName: "local_issue_lint",
  isError,
  result: { details },
});
const marker = { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "PI_LINT_SMOKE_COMPLETE" }] } };
const registration = { type: "response", command: "get_commands", success: true, data: { commands: [command] } };
const validResult = toolResult({ ok: true, summary: { scanned: 1, errors: 0 }, findings: [] });
const agentEnd = { type: "agent_end", messages: [{ role: "system", toolsAdded: [{ name: "local_issue_lint" }] }] };
const observations = (responses = [registration, validResult, marker, agentEnd], fullOutput = "", exit_code = 0, process_exited = true) =>
  ({ responses, fullOutput, exit_code, process_exited, expectedVersion: "1.3.0" });
const reloadObservations = (firstResponses = [registration], secondResponses = [registration, validResult, marker], fullOutput = "", exit_code = 0, process_exited = true) => ({
  ...observations([...firstResponses, ...secondResponses], fullOutput, exit_code, process_exited),
  responsesByProcess: [firstResponses, secondResponses],
});

test("contract and JSONL parser accept LF and CRLF response lines", () => {
  assert.equal(VERIFICATION_CONTRACT, "pi-sdk-behavior-v2");
  assert.deepEqual(parseJsonLines(`not-json\r\n${JSON.stringify(registration)}\n\n`), [registration]);
});

test("happy path requires the actual tool result and final model response", () => {
  assert.equal(behaviorAssertions("happy_path", observations())[0].passed, true);
  for (const responses of [[], [registration, marker], [registration, toolResult(validResult.result.details, true), marker], [registration, validResult]]) {
    assert.equal(behaviorAssertions("happy_path", observations(responses))[0].passed, false);
  }
});

test("handled error path requires the actual TARGET_NOT_FOUND result", () => {
  const missing = toolResult({ ok: false, summary: { scanned: 0, errors: 1 }, findings: [{ code: "TARGET_NOT_FOUND" }] });
  assert.equal(behaviorAssertions("error_path", observations([registration, missing, marker]))[0].passed, true);
  for (const responses of [[], [registration, marker], [registration, toolResult({ ok: false, summary: { errors: 1 }, findings: [] }), marker], [registration, toolResult({ ok: false, summary: { errors: 1 }, findings: [{ code: "OTHER" }] }, true), marker]]) {
    assert.equal(behaviorAssertions("error_path", observations(responses))[0].passed, false);
  }
});

test("reload requires second-host registration, feature response, and clean process exit", () => {
  const good = behaviorAssertions("reload_cleanup", reloadObservations());
  assert.deepEqual(good.map((item) => item.id), ["reloaded_extension_registered", "reloaded_feature_response", "clean_shutdown"]);
  assert.ok(good.every((item) => item.passed));
  const firstHostOnlyRegistration = reloadObservations([registration], [validResult, marker]);
  assert.equal(behaviorAssertions("reload_cleanup", firstHostOnlyRegistration)[0].passed, false);
  const firstHostOnlyFeature = reloadObservations([registration, validResult, marker], [registration]);
  assert.equal(behaviorAssertions("reload_cleanup", firstHostOnlyFeature)[1].passed, false);
  const missingSecondHost = { ...reloadObservations([registration, validResult, marker]), responsesByProcess: [[registration, validResult, marker]] };
  assert.ok(behaviorAssertions("reload_cleanup", missingSecondHost).slice(0, 2).every((item) => !item.passed));
  for (const secondResponses of [[], [validResult, marker], [registration], [registration, validResult]]) {
    assert.ok(behaviorAssertions("reload_cleanup", reloadObservations([registration], secondResponses)).some((item) => !item.passed));
  }
  for (const [output, code, exited] of [["shutdown error", 0, true], ["UnhandledPromiseRejection", 0, true], ["", 1, true], ["", 0, false]]) {
    assert.equal(behaviorAssertions("reload_cleanup", reloadObservations([registration], undefined, output, code, exited))[2].passed, false);
  }
});

test("extension registration and native shell assertions fail closed on missing or wrong responses", () => {
  assert.equal(behaviorAssertions("extension_load", observations())[0].passed, true);
  assert.equal(behaviorAssertions("extension_load", observations([]))[0].passed, false);
  assert.equal(behaviorAssertions("extension_load", observations([{ ...registration, success: false }]))[0].passed, false);
  assert.equal(behaviorAssertions("extension_load", observations([registration, { type: "agent_end", messages: [] }]))[0].passed, false);
  assert.equal(behaviorAssertions("host_shell", observations([], "1.3.0\r\n"))[0].passed, true);
  for (const value of ["", "11.1.0", "1.0.0", "1.3.0 extra"]) {
    assert.equal(behaviorAssertions("host_shell", observations([], value))[0].passed, false);
  }
});
