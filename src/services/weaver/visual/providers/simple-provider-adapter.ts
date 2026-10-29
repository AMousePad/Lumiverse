import { getImageProvider } from "../../../../image-gen/registry";
import "../../../../image-gen/index";
import type {
  WeaverVisualProvider,
  WeaverVisualAsset,
  WeaverVisualImageInputMechanism,
  WeaverVisualSourceImage,
} from "../../../../types/weaver";
import type { VisualProviderAdapter } from "../provider-adapter";

type SimpleVisualProvider = Exclude<
  WeaverVisualProvider,
  "comfyui"
>;

const IMAGE_INPUT: Record<SimpleVisualProvider, WeaverVisualImageInputMechanism | null> = {
  google_gemini: "edit",
  nanogpt: "edit",
  novelai: "reference",
  openrouter: "edit",
  sdapi: "init",
  openai: "edit",
  pollinations: null,
  custom_openai: null,
  together: "edit",
  xai: "edit",
  venice: null,
  venice_compat: null,
  recraft: null,
  deepinfra: null,
  ideogram: "edit",
  fireworks: null,
  stability: "edit",
  bfl: "edit",
  fal: "edit",
  replicate: null,
  leonardo: null,
  runware: "init",
  civitai: null,
  civitai_chat: null,
  huggingface: null,
  swarmui: "init",
};

const NAI_REFERENCE_STRENGTH = 0.6;
const INIT_DENOISE_DEFAULT = 0.5;
const IMAGE_PAYLOAD_KEYS = new Set([
  "resolvedSourceImages",
  "referenceImages",
  "resolvedReferenceImages",
  "init_images",
]);

export function snapshotParameters(parameters: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(parameters).map(([key, value]) =>
      IMAGE_PAYLOAD_KEYS.has(key) ? [key, "[source image]"] : [key, value],
    ),
  );
}

function applySourceImage(
  provider: SimpleVisualProvider,
  source: WeaverVisualSourceImage,
  parameters: Record<string, any>,
): void {
  switch (provider) {
    case "google_gemini":
    case "openrouter":
    case "openai":
    case "xai":
    case "ideogram":
    case "bfl":
    case "fal":
    case "together":
      parameters.resolvedSourceImages = [{ data: source.data, mimeType: source.mimeType }];
      return;
    case "stability":
      parameters.resolvedSourceImages = [{ data: source.data, mimeType: source.mimeType }];
      if (parameters.strength == null) parameters.strength = INIT_DENOISE_DEFAULT;
      return;
    case "runware":
      parameters.resolvedSourceImages = [{ data: source.data, mimeType: source.mimeType }];
      if (parameters.strength == null) parameters.strength = INIT_DENOISE_DEFAULT;
      return;
    case "nanogpt":
      parameters.referenceImages = [{ data: source.data, mimeType: source.mimeType }];
      if (parameters.strength == null) parameters.strength = INIT_DENOISE_DEFAULT;
      return;
    case "novelai":
      parameters.resolvedReferenceImages = [
        {
          data: source.data,
          strength: parameters.referenceStrength ?? NAI_REFERENCE_STRENGTH,
          infoExtracted: 1,
          refType: "character&style",
        },
      ];
      return;
    case "sdapi":
      parameters.mode = "img2img";
      parameters.init_images = `data:${source.mimeType};base64,${source.data}`;
      if (parameters.denoising_strength == null) parameters.denoising_strength = INIT_DENOISE_DEFAULT;
      return;
    case "swarmui":
      parameters.resolvedSourceImages = [{ data: source.data, mimeType: source.mimeType }];
      return;
    default:
      return;
  }
}

function filterSupportedParameters(
  provider: SimpleVisualProvider,
  parameters: Record<string, any> | null | undefined,
): Record<string, any> {
  const schema = getImageProvider(provider)?.capabilities.parameters ?? {};
  return Object.fromEntries(
    Object.entries(parameters ?? {}).filter(([key]) => key in schema),
  );
}

function buildProviderSpecificParameters(
  provider: SimpleVisualProvider,
  asset: WeaverVisualAsset,
): Record<string, any> {
  const sizeParams = (asset.provider_state?.params ?? {}) as Record<string, unknown>;
  const width = sizeParams.width != null ? Number(sizeParams.width) : NaN;
  const height = sizeParams.height != null ? Number(sizeParams.height) : NaN;
  const stateWidth = Number.isFinite(width) && width > 0 ? width : asset.width;
  const stateHeight = Number.isFinite(height) && height > 0 ? height : asset.height;
  const seed = asset.seed != null ? { seed: asset.seed } : {};

  switch (provider) {
    case "novelai":
      return {
        resolution: `${asset.width}x${asset.height}`,
        ...seed,
      };
    case "nanogpt":
      return {
        size: `${asset.width}x${asset.height}`,
        ...seed,
      };
    case "google_gemini":
    case "openrouter":
    case "fireworks":
    case "stability":
    case "civitai_chat":
      return {
        aspectRatio: asset.aspect_ratio,
        ...seed,
      };
    // Ideogram 4.5 takes `size` and 3.0/2.x take `aspect_ratio`; send both so
    // the provider picks per model. 4.0's `resolution` is a fixed enum, so it is
    // left to the connection default rather than derived from the scene size.
    case "ideogram":
      return {
        size: `${stateWidth}x${stateHeight}`,
        aspectRatio: asset.aspect_ratio.replace(":", "x"),
        ...seed,
      };
    case "together":
    case "deepinfra":
    case "venice_compat":
    case "recraft":
    case "custom_openai":
      return {
        size: `${stateWidth}x${stateHeight}`,
        ...seed,
      };
    // xAI sizes with aspect_ratio (not `size`); other reference-image providers
    // that take an aspect ratio are grouped above.
    case "xai":
      return {
        aspectRatio: asset.aspect_ratio,
        ...seed,
      };
    case "venice":
    case "leonardo":
    case "bfl":
    case "runware":
    case "civitai":
      return {
        width: stateWidth,
        height: stateHeight,
        ...seed,
      };
    case "fal":
      return {
        imageSize: falSizePreset(stateWidth, stateHeight),
        ...seed,
      };
    case "replicate":
      return {
        aspectRatio: asset.aspect_ratio,
        ...seed,
      };
    case "huggingface":
      return { ...seed };
    case "pollinations":
    case "sdapi":
    case "swarmui": {
      return {
        width: stateWidth,
        height: stateHeight,
        ...seed,
      };
    }
    default:
      return {};
  }
}

function falSizePreset(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.4) return "landscape_16_9";
  if (ratio > 1.05) return "landscape_4_3";
  if (ratio < 0.72) return "portrait_16_9";
  if (ratio < 0.96) return "portrait_4_3";
  return "square_hd";
}

export function createSimpleProviderAdapter(
  provider: SimpleVisualProvider,
): VisualProviderAdapter {
  return {
    provider,
    supportsWorkflowImport: false,
    supportsAdvancedMode: false,
    imageInput: IMAGE_INPUT[provider],
    checkImageInput(connection) {
      if (provider === "novelai" && connection.model.startsWith("nai-diffusion-5")) {
        return {
          supported: false,
          mechanism: null,
          reason: "NovelAI V5 does not currently support Vibe Transfer or Precise Reference.",
        };
      }
      // Stability's Core endpoint has no image-to-image mode; Ultra and SD3 do.
      if (provider === "stability" && connection.model === "core") {
        return {
          supported: false,
          mechanism: null,
          reason: "Stable Image Core does not accept a source image. Use the Ultra or SD3 model.",
        };
      }
      return { supported: true, mechanism: IMAGE_INPUT[provider] };
    },
    async validate(asset, connection) {
      const errors: string[] = [];
      if (connection.provider !== provider) {
        errors.push(`Connection provider must be ${provider}.`);
      }
      if (!asset.prompt.trim()) {
        errors.push("Visual asset prompt is required.");
      }
      if (!connection.model?.trim()) {
        errors.push("Connection model is required.");
      }
      if (provider === "novelai" && connection.model.startsWith("nai-diffusion-5") && asset.source_image) {
        errors.push("NovelAI V5 does not currently support Vibe Transfer or Precise Reference.");
      }
      return errors;
    },
    async build(asset, connection) {
      const supportedDefaults = filterSupportedParameters(
        provider,
        connection.default_parameters,
      );
      const assetParams = filterSupportedParameters(
        provider,
        asset.provider_state?.params as Record<string, any> | undefined,
      );
      const providerParameters = buildProviderSpecificParameters(provider, asset);
      const parameters = {
        ...supportedDefaults,
        ...assetParams,
        ...providerParameters,
      };

      if (asset.source_image) {
        applySourceImage(provider, asset.source_image, parameters);
      }

      return {
        request: {
          prompt: asset.prompt,
          negativePrompt: asset.negative_prompt || undefined,
          model: connection.model,
          parameters,
        },
        settingsSnapshot: {
          provider,
          model: connection.model,
          parameters: snapshotParameters(parameters),
        },
      };
    },
  };
}
