import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function jobId(index) {
  return `job-${String(index).padStart(6, "0")}`;
}

export async function ensureDistributedQueue(queueDir) {
  const resolvedDir = resolve(queueDir);
  const pendingDir = join(resolvedDir, "pending");
  const claimedDir = join(resolvedDir, "claimed");
  const doneDir = join(resolvedDir, "done");
  const failedDir = join(resolvedDir, "failed");
  const manifestPath = join(resolvedDir, "manifest.json");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(claimedDir, { recursive: true });
  await mkdir(doneDir, { recursive: true });
  await mkdir(failedDir, { recursive: true });
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    return { queueDir: resolvedDir, pendingDir, claimedDir, doneDir, failedDir, manifestPath, manifest };
  } catch {
    const manifest = {
      version: 1,
      generatedAt: nowIso(),
      queueDir: resolvedDir,
      nextJobIndex: 1,
      jobs: [],
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    return { queueDir: resolvedDir, pendingDir, claimedDir, doneDir, failedDir, manifestPath, manifest };
  }
}

async function saveManifest(context) {
  context.manifest.generatedAt = nowIso();
  await writeFile(context.manifestPath, `${JSON.stringify(context.manifest, null, 2)}\n`, "utf-8");
}

export async function enqueueSelfPlayJobs(queueDir, jobSpecs = []) {
  const context = await ensureDistributedQueue(queueDir);
  const queued = [];
  for (const spec of jobSpecs) {
    const id = spec.id ?? jobId(context.manifest.nextJobIndex);
    const entry = {
      id,
      createdAt: nowIso(),
      status: "pending",
      kind: spec.kind ?? "selfplay",
      payload: spec.payload ?? spec,
      history: [{ at: nowIso(), status: "pending" }],
    };
    const path = join(context.pendingDir, `${id}.json`);
    await writeFile(path, `${JSON.stringify(entry, null, 2)}\n`, "utf-8");
    context.manifest.jobs.push({
      id,
      status: "pending",
      kind: entry.kind,
      file: path,
    });
    context.manifest.nextJobIndex += 1;
    queued.push(entry);
  }
  await saveManifest(context);
  return queued;
}

export async function claimNextJob(queueDir, hostId) {
  const context = await ensureDistributedQueue(queueDir);
  for (const job of context.manifest.jobs) {
    if (job.status !== "pending") continue;
    const pendingPath = join(context.pendingDir, `${job.id}.json`);
    const claimedPath = join(context.claimedDir, `${job.id}--${hostId}.json`);
    try {
      await rename(pendingPath, claimedPath);
      const claimed = JSON.parse(await readFile(claimedPath, "utf-8"));
      claimed.status = "claimed";
      claimed.claimedBy = hostId;
      claimed.claimedAt = nowIso();
      claimed.history.push({ at: nowIso(), status: "claimed", hostId });
      await writeFile(claimedPath, `${JSON.stringify(claimed, null, 2)}\n`, "utf-8");
      job.status = "claimed";
      job.file = claimedPath;
      job.claimedBy = hostId;
      await saveManifest(context);
      return claimed;
    } catch {
      continue;
    }
  }
  return null;
}

async function finalizeJob(queueDir, jobIdValue, fromStatus, toStatus, output = {}) {
  const context = await ensureDistributedQueue(queueDir);
  const job = context.manifest.jobs.find((entry) => entry.id === jobIdValue);
  if (!job) {
    throw new Error(`Job "${jobIdValue}" not found.`);
  }
  if (job.status !== fromStatus) {
    throw new Error(`Job "${jobIdValue}" is not in status "${fromStatus}".`);
  }
  const claimedPath = job.file;
  const destinationDir = toStatus === "done" ? context.doneDir : context.failedDir;
  const destinationPath = join(destinationDir, `${job.id}.json`);
  await rename(claimedPath, destinationPath);
  const payload = JSON.parse(await readFile(destinationPath, "utf-8"));
  payload.status = toStatus;
  payload.completedAt = nowIso();
  payload.output = output;
  payload.history.push({ at: nowIso(), status: toStatus });
  await writeFile(destinationPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  job.status = toStatus;
  job.file = destinationPath;
  job.output = output;
  await saveManifest(context);
  return payload;
}

export async function completeJob(queueDir, jobIdValue, output = {}) {
  return finalizeJob(queueDir, jobIdValue, "claimed", "done", output);
}

export async function failJob(queueDir, jobIdValue, output = {}) {
  return finalizeJob(queueDir, jobIdValue, "claimed", "failed", output);
}

export async function queueStatus(queueDir) {
  const { manifest, manifestPath } = await ensureDistributedQueue(queueDir);
  const counts = manifest.jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    manifestPath,
    counts,
    jobs: manifest.jobs,
  };
}
