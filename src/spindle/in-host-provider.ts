import type { SpindleManifest } from "lumiverse-spindle-types";
import {
  assertCapabilityCompatibility,
  declaredCapabilitiesFromManifest,
} from "./manager.service";

export function inHostProviderEligible(manifest: SpindleManifest): boolean {
  if (!manifest.host_module) return false;
  const declared = declaredCapabilitiesFromManifest(manifest);
  if (!declared.has("dynamic_module")) return false;
  assertCapabilityCompatibility(declared, manifest.identifier);
  return true;
}
