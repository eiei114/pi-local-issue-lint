import { appendFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  return result.status === 0 ? result.stdout.trimEnd() : null;
}

function versionFromJson(json) {
  try {
    const version = JSON.parse(json).version;
    return typeof version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
      ? version
      : null;
  } catch {
    return null;
  }
}

function versionAt(ref) {
  const json = git(["show", `${ref}:package.json`]);
  return json === null ? null : versionFromJson(json);
}

function latestReleaseTag() {
  const tags = git(["tag", "--list", "v*", "--sort=-version:refname"]);
  if (tags === null) return null;
  return tags.split(/\r?\n/).find((tag) => /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) ?? null;
}

function output(released, tag) {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) throw new Error("GITHUB_OUTPUT is not set");
  appendFileSync(path, `released=${released}\n`);
  if (tag) appendFileSync(path, `tag=${tag}\n`);
}

const currentVersion = versionFromJson(readFileSync("package.json", "utf8"));
if (!currentVersion) throw new Error("package.json does not contain a valid version");

const eventName = process.env.GITHUB_EVENT_NAME;
let baselineRef;
if (eventName === "workflow_dispatch") {
  const tag = latestReleaseTag();
  if (!tag) {
    console.log("No release tag is available as a manual release baseline; skipping.");
    output(false);
    process.exit(0);
  }
  baselineRef = tag;
} else if (eventName === "push") {
  baselineRef = process.env.RELEASE_EVENT_BEFORE;
  if (!baselineRef || /^0+$/.test(baselineRef)) {
    console.log("No previous commit is available; skipping auto release.");
    output(false);
    process.exit(0);
  }
} else {
  console.log(`Unsupported event ${eventName ?? "(unset)"}; skipping release.`);
  output(false);
  process.exit(0);
}

const previousVersion = versionAt(baselineRef);
if (!previousVersion) {
  console.log(`No package.json version is available at ${baselineRef}; skipping.`);
  output(false);
  process.exit(0);
}

if (currentVersion === previousVersion) {
  console.log(`package.json version did not change (${currentVersion}); skipping.`);
  output(false);
  process.exit(0);
}

const tag = `v${currentVersion}`;
const existingTags = git(["tag", "--list", tag]);
if (existingTags === null) throw new Error("Could not list release tags");
if (existingTags.split(/\r?\n/).includes(tag)) {
  console.log(`Tag ${tag} already exists; skipping.`);
  output(false);
  process.exit(0);
}

console.log(`Version bump detected: ${previousVersion} -> ${currentVersion}.`);
output(true, tag);
