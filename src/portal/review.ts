/**
 * Review answer path — store answers, optionally refresh dry-run artifacts.
 * AI/UI never mutates CanonicalMenu directly.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DecisionPolicyRegistry } from "../decisions/engine.js";
import { DecisionStore } from "../decisions/store.js";
import type { HumanReviewAnswer, ScopePreference } from "../decisions/types.js";
import { getPortalStore, type PortalStore } from "./store.js";
import type { ReviewAnswer } from "./types.js";

export type SubmitReviewInput = {
  questionId: string;
  employeeId: string;
  selectedOptionId: string;
  resolution: string;
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
): { answer: ReviewAnswer; resolvedIds: string[]; remaining: number } {
  const question = store.getQuestion(input.questionId);
  if (!question) throw new Error("Question not found");

  const result = store.answerQuestion(input);

  // If a DecisionStore case exists, record HumanDecision (M6 path).
  if (question.decisionCaseId && process.env.PORTAL_DECISION_DB_PATH) {
    try {
      const decisionStore = new DecisionStore(process.env.PORTAL_DECISION_DB_PATH);
      const registry = new DecisionPolicyRegistry(decisionStore);
      const decisionCase = decisionStore.getCase(question.decisionCaseId);
      if (decisionCase) {
        const answer: HumanReviewAnswer = {
          decisionCaseId: question.decisionCaseId,
          resolution: input.resolution,
          selectedOptionId: input.selectedOptionId,
          scopePreference: mapScope(input.scopePreference),
          operatorId: input.employeeId,
        };
        if (input.comment) {
          answer.comment = input.comment;
        }
        registry.recordHumanDecision(decisionCase, answer);
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
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  return {
    answer: result.answer,
    resolvedIds: result.resolvedIds,
    remaining: store.listOpenQuestions(question.jobId).length,
  };
}
