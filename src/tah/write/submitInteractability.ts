import type { Locator, Page } from "playwright";

export type SubmitInteractabilityResult =
  | {
      ok: true;
      cookieBannerDismissed: boolean;
      buttonVisible: boolean;
      buttonEnabled: boolean;
      coveredByOverlay: false;
    }
  | {
      ok: false;
      code: "SUBMIT_CONTROL_BLOCKED_BY_OVERLAY" | "SUBMIT_CONTROL_NOT_INTERACTABLE";
      cookieBannerDismissed: boolean;
      buttonVisible: boolean;
      buttonEnabled: boolean;
      coveredByOverlay: boolean;
      elementFromPointTag: string | null;
      detail?: string;
    };

/**
 * HUMAN_CONFIRMED (M3H): cookie/consent banners may physically block Skab/Opdater.
 * Dismiss known cookie banner safely — never use force-click to pierce overlays.
 */
export async function dismissKnownCookieBanner(page: Page): Promise<boolean> {
  const btn = page.getByRole("button", {
    name: /allow cookies|accept cookies|accept all|tillad/i,
  });
  if ((await btn.count()) === 0) return false;
  try {
    await btn.first().click({ timeout: 3_000 });
    await page
      .locator(".js-cookie-consent, .cookie-consent, [class*='cookie-consent']")
      .first()
      .waitFor({ state: "hidden", timeout: 5_000 })
      .catch(() => undefined);
    await page.waitForTimeout(300);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a submit control is visible, enabled, and not covered by an overlay.
 * Does not click with { force: true }.
 */
export async function assertSubmitControlInteractable(
  page: Page,
  button: Locator,
): Promise<SubmitInteractabilityResult> {
  const cookieBannerDismissed = await dismissKnownCookieBanner(page);
  await button.scrollIntoViewIfNeeded();

  const visible = await button.isVisible().catch(() => false);
  const enabled = await button.isEnabled().catch(() => false);
  if (!visible || !enabled) {
    return {
      ok: false,
      code: "SUBMIT_CONTROL_NOT_INTERACTABLE",
      cookieBannerDismissed,
      buttonVisible: visible,
      buttonEnabled: enabled,
      coveredByOverlay: false,
      elementFromPointTag: null,
      detail: !visible ? "button not visible" : "button disabled",
    };
  }

  const hit = await button.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const isSelfOrChild = Boolean(top && (top === el || el.contains(top)));
    const overlayAncestor = top?.closest(
      ".js-cookie-consent, .cookie-consent, [class*='cookie-consent'], .modal, [role='dialog']",
    );
    return {
      tag: top?.tagName || null,
      className: (top as HTMLElement | null)?.className?.toString?.().slice(0, 80) || null,
      isSelfOrChild,
      coveredByKnownOverlay: Boolean(overlayAncestor && !el.contains(overlayAncestor)),
    };
  });

  if (hit.coveredByKnownOverlay || !hit.isSelfOrChild) {
    // One more dismiss attempt if cookie still covering
    if (hit.coveredByKnownOverlay) {
      await dismissKnownCookieBanner(page);
      await button.scrollIntoViewIfNeeded();
      const hit2 = await button.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return {
          tag: top?.tagName || null,
          isSelfOrChild: Boolean(top && (top === el || el.contains(top))),
          coveredByKnownOverlay: Boolean(
            top?.closest(
              ".js-cookie-consent, .cookie-consent, [class*='cookie-consent']",
            ) && !(top && el.contains(top)),
          ),
        };
      });
      if (hit2.isSelfOrChild && !hit2.coveredByKnownOverlay) {
        return {
          ok: true,
          cookieBannerDismissed: true,
          buttonVisible: true,
          buttonEnabled: true,
          coveredByOverlay: false,
        };
      }
      return {
        ok: false,
        code: "SUBMIT_CONTROL_BLOCKED_BY_OVERLAY",
        cookieBannerDismissed: true,
        buttonVisible: true,
        buttonEnabled: true,
        coveredByOverlay: true,
        elementFromPointTag: hit2.tag,
        detail: "cookie/consent or overlay still covers submit control",
      };
    }
    return {
      ok: false,
      code: "SUBMIT_CONTROL_BLOCKED_BY_OVERLAY",
      cookieBannerDismissed,
      buttonVisible: true,
      buttonEnabled: true,
      coveredByOverlay: true,
      elementFromPointTag: hit.tag,
      detail: `elementFromPoint=${hit.tag}.${hit.className}`,
    };
  }

  return {
    ok: true,
    cookieBannerDismissed,
    buttonVisible: true,
    buttonEnabled: true,
    coveredByOverlay: false,
  };
}
