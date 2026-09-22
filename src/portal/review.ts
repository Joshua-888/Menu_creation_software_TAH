/**
 * Review answer path — store answers, optionally refresh dry-run artifacts.
 * AI/UI never mutates CanonicalMenu directly.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DecisionPolicyRegistry } from "../decisions/engine.js";
import { DecisionStore } from "../decisions/store.js";
import type { HumanReviewAnswer, ScopePreference } from "../decisions/types.js";
import {
  applyTilbehorOverrideFromAnswer,
  resolvePortalDecisionDbPath,
  TILBEHOR_OVERRIDE_DECISION_TYPE,
} from "../learning/tilbehorOverride.js";
import { getPortalStore, type PortalStore } from "./store.js";
import { repoRoot } from "./paths.js";
import type { ReviewAnswer } from "./types.js";

export type SubmitReviewInput = {
  questionId: string;
  employeeId: string;
  selectedOptionId: string;
  /** Optional; ignored — store derives resolution from the option id. */
  resolution?: string;
  scopePreference: ReviewAnswer["scopePreference"];
  comment?: string | null;
};

function mapScope(s: ReviewAnswer["scopePreference"]): ScopePreference {
  switch (s) {
    case "batch_similar":
      return "APPLY_TO_THIS_RESTAURANT_CATEGORY";
    case "restaurant":
      return "APPLY_TO_THIS_RESTAURANT";
    case "global":
      return "PROPOSE_GLOBAL_RULE";
    default:
      return "APPLY_THIS_CASE_ONLY";
  }
}

export function submitReviewAnswer(
  input: SubmitReviewInput,
  store: PortalStore = getPortalStore(),
): {
  answer: ReviewAnswer;
  resolvedIds: string[];
  remaining: number;
  scheduledPostReviewLive?: boolean;
  tilbehorFactId?: string | null;
} {
  const question = store.getQuestion(input.questionId);
  if (!question) throw new Error("Question not found");

  const result = store.answerQuestion(input);
  let tilbehorFactId: string | null = null;

  // Record HumanDecision (+ Tilbehør BUSINESS_FACT override when applicable).
  if (question.decisionCaseId) {
    const root = repoRoot();
    const dbPath = resolvePortalDecisionDbPath(root);
    mkdirSync(join(root, "runs", "decisions"), { recursive: true });
    try {
      const decisionStore = new DecisionStore(dbPath);
      const registry = new DecisionPolicyRegistry(decisionStore);
      const decisionCase = decisionStore.getCase(question.decisionCaseId);
      if (decisionCase) {
        const answer: HumanReviewAnswer = {
          decisionCaseId: question.decisionCaseId,
          resolution: result.answer.resolution,
          selectedOptionId: input.selectedOptionId,
          scopePreference: mapScope(input.scopePreference),
          operatorId: input.employeeId,
        };
        if (input.comment) {
          answer.comment = input.comment;
        }
        const recorded = registry.recordHumanDecision(decisionCase, answer);
        if (decisionCase.decisionType === TILBEHOR_OVERRIDE_DECISION_TYPE) {
          const fact = applyTilbehorOverrideFromAnswer({
            store: decisionStore,
            decisionCase,
            answer,
            humanDecision: recorded.human,
          });
          tilbehorFactId = fact?.factId ?? null;
        }
      }
      decisionStore.close();
    } catch (err) {
      console.warn(
        "[portal-review] DecisionStore record skipped:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Append to run artifacts for audit
  const run = store.latestJobRun(question.jobId);
  if (run?.runDir) {
    const path = join(run.runDir, "review-answers.json");
    let list: unknown[] = [];
    if (existsSync(path)) {
      try {
        list = JSON.parse(readFileSync(path, "utf8")) as unknown[];
      } catch {
        list = [];
      }
    }
    list.push({
      ...result.answer,
      resolvedIds: result.resolvedIds,
      ...(tilbehorFactId ? { tilbehorFactId } : {}),
    });
    writeFileSync(path, JSON.stringify(list, null, 2), "utf8");

    const remainingPath = join(run.runDir, "remaining-review.json");
    const open = store.listOpenQuestions(question.jobId);
    writeFileSync(
      remainingPath,
      JSON.stringify(
        {
          count: open.length,
          questions: open.map((q) => ({
            id: q.id,
            type: q.questionType,
            title: q.title,
            prompt: q.prompt,
            productRef: q.productRef,
            batchKey: q.batchKey,
            decisionCaseId: q.decisionCaseId,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  const remaining = store.listOpenQuestions(question.jobId).length;
  if (remaining === 0) {
    const job = store.getJob(question.jobId);
    // Safety: never promote a BLOCKED MenuQualityContract to operator approval.
    // STATE_MACHINE_V1 defines no blocked-pending-approval status, so blocked
    // jobs settle on READY_DRY_RUN (the same state answerQuestion selects).
    const qualityBlocked =
      job?.workflow === "CREATE_MENU" &&
      store.isMenuQualityBlocked(question.jobId);
    if (job?.workflow === "CREATE_MENU" && !qualityBlocked) {
      store.updateJobStatus(question.jobId, "AWAITING_OPERATOR_APPROVAL", {
        remainingQuestions: 0,
        errorMessage: null,
      });
      const latest = store.latestJobRun(question.jobId);
      if (latest?.runDir) {
        const targetPath = join(latest.runDir, "target-menu.json");
        const planPath = join(latest.runDir, "dry-run-writeplan.json");
        try {
          const target = JSON.parse(readFileSync(targetPath, "utf8")) as {
            categories?: Array<{ products?: unknown[] }>;
          };
          const plan = JSON.parse(readFileSync(planPath, "utf8")) as {
            operations?: Array<{ entityType?: string; action?: string }>;
          };
          const operations = plan.operations ?? [];
          writeFileSync(
            join(latest.runDir, "awaiting-operator-approval.json"),
            JSON.stringify(
              {
                jobId: question.jobId,
                createdAt: new Date().toISOString(),
                targetMenu: {
                  categoryCount: target.categories?.length ?? 0,
                  productCount:
                    target.categories?.reduce(
                      (count, category) =>
                        count + (category.products?.length ?? 0),
                      0,
                    ) ?? 0,
                },
                writePlan: {
                  categoryCreates: operations.filter(
                    (op) =>
                      op.entityType === "category" && op.action === "CREATE",
                  ).length,
                  productCreates: operations.filter(
                    (op) =>
                      op.entityType === "product" && op.action === "CREATE",
                  ).length,
                },
                staging: {
                  productsHiddenByDefault: true,
                  categoryCreateCustomerFacing: true,
                },
              },
              null,
              2,
            ),
            "utf8",
          );
        } catch (err) {
          console.warn(
            "[portal-review] approval artifact write skipped:",
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  }
  return {
    answer: result.answer,
    resolvedIds: result.resolvedIds,
    remaining,
    scheduledPostReviewLive: false,
    ...(tilbehorFactId ? { tilbehorFactId } : {}),
  };
}
