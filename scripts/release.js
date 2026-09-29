// Release preparation script (adapted from worker-mcp/scripts/release.js).
//
// Prepares a version-bump release PR: release/vX.Y.Z branch, package.json
// version bump, flake.nix version sync (when the flake declares one), and a
// `gh pr create` against main.
//
// Merging the release PR is the release trigger (see AGENTS.md): the
// release workflow tags the release commit on main as vX.Y.Z, gates on
// typecheck + tests, creates the GitHub release, and publishes to npm.
// This script intentionally stops at opening the PR.
//
// Usage: node scripts/release.js <patch|minor|major|X.Y.Z>
import { execSync } from "node:child_process";
import fs from "node:fs";

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", ...opts });
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function nextVersionFrom(current, releaseType) {
  const parts = current.split(".").map(Number);
  if (releaseType === "patch") return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  if (releaseType === "minor") return `${parts[0]}.${parts[1] + 1}.0`;
  if (releaseType === "major") return `${parts[0] + 1}.0.0`;
  return null;
}

// 1. Get the release type or version argument
const releaseType = process.argv[2];
if (!releaseType) {
  console.error("Usage: node scripts/release.js <patch|minor|major|X.Y.Z>");
  process.exit(1);
}

try {
  // 2. Check if git status is clean
  const gitStatus = sh("git status --porcelain").trim();
  if (gitStatus) {
    fail("Git working directory is not clean. Please commit or stash your changes first.");
  }

  // 3. Release branches are cut from an up-to-date main
  const branch = sh("git branch --show-current").trim();
  if (branch !== "main") {
    fail(`Must be on main to start a release (currently on ${branch}).`);
  }
  sh("git fetch origin main", { stdio: "inherit" });
  const local = sh("git rev-parse HEAD").trim();
  const remote = sh("git rev-parse origin/main").trim();
  if (local !== remote) {
    fail("main is not in sync with origin/main. Run `git pull --ff-only` first.");
  }

  // 4. Read current version and calculate next version
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const currentVersion = pkg.version;

  let nextVersion = nextVersionFrom(currentVersion, releaseType);
  if (nextVersion === null) {
    // Assume a specific version string was passed (allow a leading v)
    const explicit = releaseType.replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(explicit)) {
      fail(`Invalid version argument: ${releaseType}`);
    }
    nextVersion = explicit;
  }

  console.log(`Current version: ${currentVersion}`);
  console.log(`Bumping to next version: ${nextVersion}`);

  // 5. Refuse to shadow an existing tag
  const tag = `v${nextVersion}`;
  const tagExists = sh(`git rev-parse -q --verify "refs/tags/${tag}" 2>/dev/null || true`).trim();
  if (tagExists) {
    fail(`Tag ${tag} already exists.`);
  }

  const branchName = `release/${tag}`;
  console.log(`Creating release branch: ${branchName}...`);
  sh(`git checkout -b ${branchName}`, { stdio: "inherit" });

  // 6. Update package.json using pnpm version
  sh(`pnpm version ${nextVersion} --no-git-tag-version`, {
    stdio: "inherit",
  });

  // 7. Update flake.nix if it declares a version (this repo's flake is a
  //    dev shell only today, so this is a guarded no-op)
  const flakePath = "flake.nix";
  if (fs.existsSync(flakePath)) {
    const flakeContent = fs.readFileSync(flakePath, "utf8");
    const versionPattern = /version\s*=\s*"[0-9]+\.[0-9]+\.[0-9]+[^"]*";/;
    if (versionPattern.test(flakeContent)) {
      console.log(`Updating version to ${nextVersion} in ${flakePath}...`);
      fs.writeFileSync(
        flakePath,
        flakeContent.replace(new RegExp(versionPattern.source, "g"), `version = "${nextVersion}";`),
        "utf8",
      );
    }
  }

  // 8. Stage files
  console.log("Staging files...");
  sh("git add package.json", { stdio: "inherit" });
  if (fs.existsSync(flakePath) && sh("git status --porcelain flake.nix").trim()) {
    sh("git add flake.nix", { stdio: "inherit" });
  }

  // Refresh the lockfile and stage it only if the version change touched it
  if (fs.existsSync("pnpm-lock.yaml")) {
    sh("pnpm install", { stdio: "inherit" });
    if (sh("git status --porcelain pnpm-lock.yaml").trim()) {
      sh("git add pnpm-lock.yaml", { stdio: "inherit" });
    }
  }

  // 9. Commit changes
  const commitMsg = `chore(release): bump version to ${tag}`;
  console.log(`Committing: "${commitMsg}"...`);
  sh(`git commit -m "${commitMsg}"`, { stdio: "inherit" });

  // 10. Push branch to remote origin
  console.log(`Pushing branch ${branchName} to origin...`);
  sh(`git push -u origin ${branchName}`, { stdio: "inherit" });

  // 11. Create Pull Request
  console.log("Creating Pull Request to main...");
  sh(
    `gh pr create --title "${commitMsg}" --assignee "@me" --body "Automated version bump to ${tag}. Merging this PR releases ${tag}: the release workflow tags the release commit, creates the GitHub release, and publishes to npm." --base main --head ${branchName}`,
    { stdio: "inherit" },
  );

  console.log(`\nRelease PR created successfully! Switched to branch ${branchName}.`);
  console.log(
    `\nMerging this PR releases ${tag} automatically (AGENTS.md):\n` +
      `  the release workflow tags the release commit on main, creates\n` +
      `  the GitHub release, and publishes to npm.\n` +
      `Escape hatch (owner only): push the tag manually on the release\n` +
      `commit - git tag ${tag} && git push origin ${tag}.\n` +
      `Agents must not push tags, create releases, or publish to npm.`,
  );
} catch (error) {
  console.error("Release script failed:", error.message);
  process.exit(1);
}
