export const CANONICAL_MENU_SCHEMA_VERSION = "1.0.0" as const;
export const DOMAIN_RULE_ENGINE_VERSION = "1.0.0" as const;

export type DomainVersions = {
  canonicalMenuSchema: typeof CANONICAL_MENU_SCHEMA_VERSION;
  domainRuleEngine: typeof DOMAIN_RULE_ENGINE_VERSION;
};

export function domainVersions(): DomainVersions {
  return {
    canonicalMenuSchema: CANONICAL_MENU_SCHEMA_VERSION,
    domainRuleEngine: DOMAIN_RULE_ENGINE_VERSION,
  };
}
