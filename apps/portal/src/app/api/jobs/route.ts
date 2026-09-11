import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getPortalStore,
  parseSignedSession,
  publicEmployee,
  SESSION_COOKIE,
  sessionSecret,
  uploadsDir,
  type JobSourceType,
} from "@engine/portal/index.js";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobs = getPortalStore().listJobs();
  return NextResponse.json({ jobs, employee: publicEmployee(emp) });
}

export async function POST(req: Request) {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const merchantName = String(form.get("merchantName") ?? "").trim();
  const destinationHost = String(form.get("destinationHost") ?? "").trim();
  const sourceUrlRaw = String(form.get("sourceUrl") ?? "").trim();
  const file = form.get("file");

  if (!merchantName || !destinationHost) {
    return NextResponse.json(
      { error: "Merchant name and destination host are required" },
      { status: 400 },
    );
  }

  const hasFile = file instanceof File && file.size > 0;
  const hasUrl = Boolean(sourceUrlRaw);
  if (!hasFile && !hasUrl) {
    return NextResponse.json(
      { error: "Provide a menu PDF and/or a source URL" },
      { status: 400 },
    );
  }

  if (hasFile && file instanceof File) {
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 25MB)" }, { status: 400 });
    }
    const mime = file.type || guessMime(file.name);
    const isPdf =
      mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return NextResponse.json(
        {
          error:
            "MVP extraction requires a PDF. Standalone image uploads are not runnable yet — convert the menu to PDF first.",
        },
        { status: 400 },
      );
    }
  }

  let sourceType: JobSourceType = "pdf_upload";
  if (hasFile && hasUrl) sourceType = "pdf_and_url";
  else if (hasUrl && !hasFile) sourceType = "source_url";

  const store = getPortalStore();
  const job = store.createJob({
    merchantName,
    destinationHost,
    sourceType,
    sourceUrl: hasUrl ? sourceUrlRaw : null,
    createdByEmployeeId: emp.id,
    status: hasFile ? "QUEUED" : "SOURCE_URL_PENDING",
  });

  if (hasFile && file instanceof File) {
    const mime = file.type || guessMime(file.name);
    const dir = join(uploadsDir(), job.id);
    mkdirSync(dir, { recursive: true });
    const safeName = file.name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 180);
    const storedPath = join(dir, `${randomUUID()}_${safeName}`);
    const buf = Buffer.from(await file.arrayBuffer());
    writeFileSync(storedPath, buf);
    store.addJobFile({
      jobId: job.id,
      originalName: file.name,
      storedPath,
      mimeType: mime || "application/pdf",
      sizeBytes: buf.length,
    });
  }

  if (hasFile) {
    const { scheduleMigrationJob } = await import("@engine/portal/worker.js");
    scheduleMigrationJob(job.id);
  } else {
    store.updateJobStatus(job.id, "SOURCE_URL_PENDING", {
      errorMessage:
        "Source URL saved. Upload a PDF to run extraction — HTML adapter not certified yet.",
    });
  }

  return NextResponse.json({ id: job.id, status: store.getJob(job.id)?.status });
}

async function currentEmployee() {
  const jar = await cookies();
  const token = parseSignedSession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!token) return null;
  return getPortalStore().getSessionEmployee(token);
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}
