import type { SourceMenu } from "../domain/schema/source.js";

/**
 * Extracts a structured SourceMenu from a heterogeneous menu source.
 * Implementations must NOT assign menu numbers or calculate TAH surcharges.
 */
export interface MenuExtractor {
  readonly extractorVersion: string;
  extract(source: MenuSource): Promise<SourceMenu>;
}

export type MenuSource =
  | { kind: "html"; url?: string; html: string }
  | { kind: "url"; url: string }
  | { kind: "pdf"; filePath: string }
  | { kind: "image"; filePath: string }
  | { kind: "json"; menu: SourceMenu };
