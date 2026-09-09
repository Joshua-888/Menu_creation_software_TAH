import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import {
  ADMIN_CONTRACT_V1,
  assertPayloadHasNoActiveTrue,
  assertVisibilityWriteCapabilitiesUncertified,
  buildAdminContractFingerprint,
  ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER,
  inspectFormSubmission,
  interpretActiveState,
  isMilestone3CanaryExecutable,
  isVisibilityWriteRoundTripComplete,
  mapListStatusText,
  mayCertifyVisibilityWrite,
  NEW_WAY_ACTIVE_READ_SEMANTICS,
  resolveActiveReadSemantics,
  TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
  TahAdminAdapterV1,
  VERONI_ACTIVE_READ_SEMANTICS,
  VISIBILITY_WRITE_CERTIFICATION_CHECKLIST,
} from "../../src/tah/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const listSkjult = join(
  root,
  "fixtures/admin-contracts/v1/m3d-veroni-list-skjult.html",
);
const editChecked = join(
  root,
  "fixtures/admin-contracts/v1/m3d-veroni-edit-active-checked.html",
);

describe("M3D active attribute vs DOM property", () => {
  it(
    "distinguishes HTML checked attribute from element.checked / defaultChecked",
    async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.setContent(readFileSync(editChecked, "utf8"));
      const evidence = await page.evaluate(() => {
        const el = document.querySelector("#active") as HTMLInputElement | null;
        return {
          tag: el?.tagName ?? null,
          type: el?.type ?? null,
          name: el?.name ?? null,
          id: el?.id ?? null,
          valueAttr: el?.getAttribute("value"),
          hasCheckedAttr: el?.hasAttribute("checked") ?? false,
          checkedAttr: el?.getAttribute("checked"),
          checkedProperty: el?.checked ?? null,
          defaultChecked: el?.defaultChecked ?? null,
          disabled: el?.disabled ?? null,
        };
      });
      expect(evidence.hasCheckedAttr).toBe(true);
      expect(evidence.checkedProperty).toBe(true);
      expect(evidence.defaultChecked).toBe(true);
      expect(evidence.valueAttr).toBe("1");
      await browser.close();
    },
    30_000,
  );
});

describe("M3D scoped active semantics", () => {
  it("keeps NEW WAY TESTED and Veroni EDIT_CHECKBOX_NOT_AUTHORITATIVE without invert hack", () => {
    expect(NEW_WAY_ACTIVE_READ_SEMANTICS.value).toBe("CHECKED_MEANS_AVAILABLE");
    expect(NEW_WAY_ACTIVE_READ_SEMANTICS.scope.kind).toBe("HOST");
    expect(VERONI_ACTIVE_READ_SEMANTICS.value).toBe(
      "EDIT_CHECKBOX_NOT_AUTHORITATIVE",
    );
    expect(resolveActiveReadSemantics({ host: "veronipizza.dk" }).value).toBe(
      "EDIT_CHECKBOX_NOT_AUTHORITATIVE",
    );
    expect(
      resolveActiveReadSemantics({ host: "newwaypizzaringsted.dk" }).value,
    ).toBe("CHECKED_MEANS_AVAILABLE");
    expect(ADMIN_CONTRACT_V1.semantics.activeReadSemantics.notes).toMatch(
      /SCOPED/i,
    );
    expect(ADMIN_CONTRACT_V1.semantics.activeReadSemantics.notes).not.toMatch(
      /invert/i,
    );
  });

  it("does not treat Veroni checkbox alone as customer availability", () => {
    const r = interpretActiveState({
      host: "veronipizza.dk",
      activeCheckbox: true,
    });
    expect(r.customerAvailable).toBeNull();
    expect(r.activeCheckbox).toBe(true);
    expect(r.semantics.value).toBe("EDIT_CHECKBOX_NOT_AUTHORITATIVE");
  });

  it("uses list Skjult as HIDDEN availability when checkbox is not authoritative", () => {
    expect(mapListStatusText("Skjult")).toBe("HIDDEN");
    const r = interpretActiveState({
      host: "veronipizza.dk",
      activeCheckbox: true,
      listStatusText: "Skjult",
    });
    expect(r.listAvailability).toBe("HIDDEN");
    expect(r.customerAvailable).toBe(false);
    expect(r.activeCheckbox).toBe(true);
  });

  it("blocks canary when active semantics are not a certified checked mapping", () => {
    expect(
      isMilestone3CanaryExecutable({
        variantPriceSemantics: "SURCHARGE",
        capabilities: ADMIN_CONTRACT_V1.capabilities,
        activeDefaultChecked: false,
        activeReadSemantics: "EDIT_CHECKBOX_NOT_AUTHORITATIVE",
      }),
    ).toBe(false);
  });
});

describe("M3D readProduct active-source authority", () => {
  it("does not map Veroni #active checked to active=true when list is Skjult", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.route("**/admin/menu", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/admin/menu" || path === "/admin/menu/") {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: readFileSync(listSkjult, "utf8"),
        });
        return;
      }
      await route.continue();
    });
    await page.route("**/admin/menu/18/edit", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: readFileSync(editChecked, "utf8"),
      });
    });

    const adapter = new TahAdminAdapterV1({
      page,
      baseUrl: "https://veronipizza.dk",
    });
    const product = await adapter.readProduct("18");
    expect(product.activeCheckbox).toBe(true);
    expect(product.active).toBe(false);
    expect(product.activeSemantics).toBe("EDIT_CHECKBOX_NOT_AUTHORITATIVE");
    expect(product.listAvailability).toBe("HIDDEN");
    await browser.close();
  });
});

describe("M3D contract fingerprint", () => {
  it("builds deterministic structural fingerprint without customer data", () => {
    const a = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
    const b = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(a.canonical).not.toMatch(/__TAH_CANARY/);
    expect(a.canonical).not.toMatch(/99001/);
    expect(a.limitations.length).toBeGreaterThan(0);
  });

  it("changes when structural field names change", () => {
    const base = buildAdminContractFingerprint(TAH_V1_STRUCTURE_FINGERPRINT_INPUT);
    const drifted = buildAdminContractFingerprint({
      ...TAH_V1_STRUCTURE_FINGERPRINT_INPUT,
      fieldNames: [...TAH_V1_STRUCTURE_FINGERPRINT_INPUT.fieldNames, "published"],
    });
    expect(drifted.fingerprint).not.toBe(base.fingerprint);
  });
});

describe("M3D zero-network form serialization", () => {
  it("serializes FormData without submit and omits unchecked checkbox", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(`<!DOCTYPE html><html><body>
      <form id="f" action="/admin/menu" method="POST">
        <input name="_token" value="SECRET" />
        <input name="menu_number" value="99001" />
        <input name="name" value="__TAH_CANARY_PRODUCT_M3__" />
        <input name="categories[]" value="1" checked type="checkbox" />
        <input name="variants[0][name]" value="Alm." />
        <input name="variants[0][price]" value="0" />
        <input name="ingredients[0][name]" value="A" />
        <input name="ingredients[1][name]" value="B" />
        <input name="active" type="checkbox" value="1" id="active" />
      </form>
    </body></html>`);

    // Ensure unchecked (successful-control omit)
    await page.locator("#active").evaluate((el) => {
      (el as HTMLInputElement).checked = false;
    });

    const { payload, mutationRequests } = await inspectFormSubmission(
      page,
      "form#f",
    );
    expect(mutationRequests).toEqual([]);
    expect(payload.asObject).not.toHaveProperty("_token");
    expect(payload.asObject).not.toHaveProperty("active");
    expect(payload.asObject.menu_number).toBe("99001");
    expect(payload.asObject["categories[]"]).toBe("1");
    expect(assertPayloadHasNoActiveTrue(payload)).toBe(true);

    // Checked case includes active
    await page.locator("#active").evaluate((el) => {
      (el as HTMLInputElement).checked = true;
    });
    const checked = await inspectFormSubmission(page, "form#f");
    expect(checked.mutationRequests).toEqual([]);
    expect(checked.payload.asObject.active).toBe("1");
    expect(assertPayloadHasNoActiveTrue(checked.payload)).toBe(false);
    await browser.close();
  });

  it("records zero POST/PUT/DELETE during payload inspection", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const seen: string[] = [];
    page.on("request", (req) => {
      const m = req.method().toUpperCase();
      if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") {
        seen.push(`${m} ${req.url()}`);
      }
    });
    await page.setContent(
      `<form id="f" method="POST" action="/admin/menu"><input name="name" value="x" /><input name="active" type="checkbox" checked value="1" /></form>`,
    );
    await inspectFormSubmission(page, "form#f");
    expect(seen).toEqual([]);
    await browser.close();
  });
});

describe("M3D no hostname invert special-case", () => {
  it("source registry does not invert boolean by restaurant name", () => {
    const src = readFileSync(
      join(root, "src/tah/contracts/activeSemantics.ts"),
      "utf8",
    );
    expect(src).not.toMatch(
      /if\s*\(\s*host\s*===?\s*["']veronipizza\.dk["']\s*\)[\s\S]{0,80}!activeCheckbox/,
    );
    expect(src).not.toMatch(/!input\.activeCheckbox/);
    expect(src).not.toMatch(/activeCheckbox\s*===\s*false\s*\?\s*true/);
  });
});

describe("HUMAN_CONFIRMED Aktiv? requires Opdater to persist", () => {
  it("documents three observation layers and Opdater persist gate", () => {
    expect(ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER.evidence).toBe(
      "HUMAN_CONFIRMED",
    );
    expect(ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER.value).toBe(
      "CHECKBOX_CHANGE_REQUIRES_OPDATER_SUBMIT",
    );
    expect(ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER.layers).toEqual([
      "EDIT_CONTROL_STATE",
      "PERSISTED_PRODUCT_STATE",
      "STOREFRONT_VISIBILITY",
    ]);
    expect(ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER.workflow).toContain(
      "EXPLICIT_APPROVED_OPDATER_SUBMIT",
    );
    expect(ACTIVE_CHECKBOX_PERSIST_REQUIRES_OPDATER.workflow).toContain(
      "INSPECT_STOREFRONT",
    );
    expect(ADMIN_CONTRACT_V1.semantics.activePersistRequiresOpdater.value).toBe(
      "CHECKBOX_CHANGE_REQUIRES_OPDATER_SUBMIT",
    );
    expect(
      ADMIN_CONTRACT_V1.semantics.activePersistRequiresOpdater.evidence,
    ).toBe("HUMAN_CONFIRMED");
    expect(ADMIN_CONTRACT_V1.selectors.active.notes).toMatch(/Opdater/i);
    expect(ADMIN_CONTRACT_V1.selectors.saveUpdate.notes).toMatch(/persist/i);
  });

  it("does not treat checkbox-only steps as a complete visibility write round-trip", () => {
    expect(
      isVisibilityWriteRoundTripComplete([
        "OPEN_PRODUCT_EDIT",
        "CHANGE_ACTIVE_CHECKBOX",
      ]),
    ).toBe(false);
    expect(
      isVisibilityWriteRoundTripComplete([
        ...VISIBILITY_WRITE_CERTIFICATION_CHECKLIST,
      ]),
    ).toBe(true);
  });

  it("keeps setProductHidden/setProductAvailable UNCERTIFIED and blocks checkbox-only certification", () => {
    expect(ADMIN_CONTRACT_V1.capabilities.write.setProductHidden).toBe(
      "UNCERTIFIED",
    );
    expect(ADMIN_CONTRACT_V1.capabilities.write.setProductAvailable).toBe(
      "UNCERTIFIED",
    );
    expect(() =>
      assertVisibilityWriteCapabilitiesUncertified(
        ADMIN_CONTRACT_V1.capabilities,
      ),
    ).not.toThrow();
    expect(
      mayCertifyVisibilityWrite({
        capabilities: ADMIN_CONTRACT_V1.capabilities,
        stepsCompleted: ["CHANGE_ACTIVE_CHECKBOX"],
        syntheticCanary: true,
        approvedOpdaterSubmit: false,
      }),
    ).toBe(false);
    expect(
      mayCertifyVisibilityWrite({
        capabilities: ADMIN_CONTRACT_V1.capabilities,
        stepsCompleted: [
          "EXPLICIT_APPROVED_OPDATER_SUBMIT",
          "INSPECT_STOREFRONT",
          "VERIFIED",
        ],
        syntheticCanary: true,
        approvedOpdaterSubmit: true,
      }),
    ).toBe(true);
  });

  it("marks interpretActiveState checkbox as edit-control-only with intended mapping", () => {
    const r = interpretActiveState({
      host: "veronipizza.dk",
      activeCheckbox: true,
      listStatusText: "Skjult",
    });
    expect(r.editControlStateOnly).toBe(true);
    expect(r.intendedFromCheckbox).toBe("AVAILABLE");
    expect(r.customerAvailable).toBe(false);
    expect(r.listAvailability).toBe("HIDDEN");
  });
});
