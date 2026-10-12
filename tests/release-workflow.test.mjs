import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

const workflow = parseDocument(readFileSync(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8")).toJS();

test("release workflow is manually dispatched with explicit confirmation", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirm_release.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirm_release.default, false);
  assert.equal(workflow.jobs.release.if, "inputs.confirm_release == true");
});
