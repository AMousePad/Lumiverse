import type { DryRunResultDTO as PublicDryRunResultDTO } from "lumiverse-spindle-types";
import type { ContextClipStats } from "../llm/types";

/** Host additions pending publication in lumiverse-spindle-types. */
export interface DryRunResultDTO extends PublicDryRunResultDTO {
  chatHistoryTokens?: number;
  contextClipStats?: ContextClipStats;
}
