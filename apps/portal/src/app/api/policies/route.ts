import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  activateStorePolicy,
  buildPolicyCatalog,
  createGlobalOperatorPolicy,
  deprecateStorePolicy,
  getPortalStore,
  openPortalDecisionStore,
  parseSignedSession,
  publicEmployee,
  repoRoot,
  SESSION_COOKIE,
  sessionSecret,
  updateOperatorGuidancePolicy,
} from "@engine/portal/index.js";

export const runtime = "nodejs";

export async function GET() {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const root = repoRoot();
  const decisionStore = openPortalDecisionStore(root);
  try {
    const catalog = buildPolicyCatalog(decisionStore, root);
    return NextResponse.json({
      catalog,
      employee: publicEmployee(emp),
    });
  } finally {
    decisionStore.close();
  }
}

export async function POST(req: Request) {
  const emp = await currentEmployee();
  if (!emp) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    title?: string;
    body?: string;
    decisionType?: string;
    action?: string;
    policyId?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const root = repoRoot();
  const decisionStore = openPortalDecisionStore(root);
  try {
    const action = body.action ?? "create";

    if (action === "deprecate") {
      if (!body.policyId) {
        return NextResponse.json({ error: "policyId required" }, { status: 400 });
      }
      const policy = deprecateStorePolicy(decisionStore, body.policyId);
      return NextResponse.json({
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        status: policy.status,
      });
    }

    if (action === "activate") {
      if (!body.policyId) {
        return NextResponse.json({ error: "policyId required" }, { status: 400 });
      }
      const policy = activateStorePolicy(decisionStore, body.policyId);
      return NextResponse.json({
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        status: policy.status,
      });
    }

    if (action === "update") {
      if (!body.policyId) {
        return NextResponse.json({ error: "policyId required" }, { status: 400 });
      }
      const policy = updateOperatorGuidancePolicy({
        store: decisionStore,
        policyId: body.policyId,
        title: String(body.title ?? ""),
        body: String(body.body ?? ""),
        createdBy: emp.email,
      });
      return NextResponse.json({
        policyId: policy.policyId,
        policyVersion: policy.policyVersion,
        status: policy.status,
      });
    }

    const policy = createGlobalOperatorPolicy({
      store: decisionStore,
      title: String(body.title ?? ""),
      body: String(body.body ?? ""),
      createdBy: emp.email,
      decisionType: body.decisionType,
      knowledgeKind: "SEMANTIC_RULE",
    });
    return NextResponse.json({
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      status: policy.status,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  } finally {
    decisionStore.close();
  }
}

async function currentEmployee() {
  const jar = await cookies();
  const token = parseSignedSession(jar.get(SESSION_COOKIE)?.value, sessionSecret());
  if (!token) return null;
  return getPortalStore().getSessionEmployee(token);
}
