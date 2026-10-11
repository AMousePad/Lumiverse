# Decision model connections

Design record researched on October 11, 2026. The initial text/JSON integration is implemented in the backend and Connections panel. The public API is available in `lumiverse-spindle-types` **0.6.45**, used by both backend and frontend. See the [implemented API](../docs/backend-api/decisions.md).

Add **Decision models** to the Connections panel, with **OpenRouter** and **TypeSafe** as built-in providers. Give extensions a typed `spindle.decisions` API backed by the user's saved connections and encrypted credentials. A decision request evaluates explicit questions against supplied context and returns values and probabilities. The extension decides what to do with those results.

The existing STT connection service and UI provide the closest starting point. Decision evaluation needs its own provider interface because the LLM interface assumes messages and text generation.

The providers already share a useful contract:

| Provider | Evaluation endpoint | Model discovery | Model identifiers |
| --- | --- | --- | --- |
| TypeSafe | `https://api.typesafe.ai/v1/systemone` | Authenticated `GET https://api.typesafe.ai/v1/models`; `{ models: [{ name, description, release_date }] }` | Preserve catalog names, including `jev-latest`; accept manually entered versioned IDs |
| OpenRouter | `https://openrouter.ai/api/v1/systemone` compatibility endpoint; `https://openrouter.ai/api/alpha/decisions` native Decisions endpoint | `GET https://openrouter.ai/api/v1/models?output_modalities=decisions`; `{ data: [...] }` | Preserve exact IDs, including the leading `~` in `~typesafe/jev-latest` |

TypeSafe documents evaluation and its account model catalog separately. OpenRouter explicitly documents both evaluation routes. [TypeSafe API](https://docs.typesafe.ai/api), [TypeSafe models](https://docs.typesafe.ai/models), [OpenRouter System One compatibility](https://openrouter.ai/docs/guides/community/typesafe-sdk), [OpenRouter Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).

**Recommended transport:** use TypeSafe's `/v1/systemone` and OpenRouter's native `/api/alpha/decisions`, sharing the question and answer types. Keep endpoint selection in the provider adapter so OpenRouter's alpha route can change without changing extension code. OpenRouter documents multimodal requests on the native route; compatibility with `/v1/systemone` for every newly listed model needs a contract check. Do not silently retry an evaluation on the other endpoint. [OpenRouter endpoint guide](https://openrouter.ai/docs/guides/community/jev), [OpenRouter multimodal guide](https://openrouter.ai/docs/guides/community/multimodal-decisions).

Model category alone does not establish endpoint compatibility. The live OpenRouter decision catalog includes Together's Tev1, whose model documentation specifies chat completions and an option-letter result. Treat this as an unsupported protocol in the initial integration; do not advertise it as supporting all three System One primitives. Preserve catalog metadata and represent transport/primitive support as known, unsupported, or unverified. A model disappearing from discovery must not erase a saved model ID. [Live catalog](https://openrouter.ai/api/v1/models?output_modalities=decisions), [Tev1 protocol](https://openrouter.ai/togethercomputer/tev1-4b-experimental).

The shared request consists of `model`, `state`, and a map of named `questions`. Each question has `instructions` and one of these shapes:

| Question | Criteria | Answer |
| --- | --- | --- |
| `choice` | Map of option keys to descriptions | `choice`, `probabilities`, `confidence` |
| `score` | Ordered rubric descriptions | `score`, `probabilities`, `confidence`, `legend` |
| `noul` | Optional descriptions for `true` and `false` | `noul`, the probability of yes |

The answer types follow the published primitive definitions. [TypeSafe primitives](https://docs.typesafe.ai/primitives).

Instructions and descriptions can contain structured JSON. Choice descriptions may be `null`. Score values can fall between rubric levels; retain their precision. Require both Noul descriptions when criteria are supplied for the portable contract. The host should validate answer keys and discriminants against the requested questions and reject malformed results. It must not synthesize missing answers or convert Noul probabilities to booleans. [TypeSafe contract](https://docs.typesafe.ai/api), [OpenRouter request and response examples](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).

**Connection behavior:** save a per-user `decision_connections` profile with the existing connection fields: UUID, name, provider, API URL, model, default flag, key status, default parameters, metadata, and timestamps. Store keys as `decision_connection_<id>_api_key` through the existing secrets service. Use the readable-key reconciliation helper for profile responses. Support create, edit, duplicate, delete, set/clear key, preview/list models, and one default per user.

Enforce default uniqueness with a partial unique index on `user_id` where `is_default = 1`, and change defaults in a database transaction. Validate provider-specific defaults before dispatch: reserved fields such as `model`, `state`, and `questions` must come from the resolved request. Start with an explicit allowlist of supported OpenRouter routing options; do not spread arbitrary connection metadata or LLM sampling parameters into an evaluation request.

Use a versioned base URL consistently in saved profiles: `https://api.typesafe.ai/v1` or `https://openrouter.ai/api/v1`. The OpenRouter adapter owns the explicitly defined sibling Decisions route; URL resolution should be parsed and tested, with no string replacement across arbitrary URLs. Extensions supply a connection ID and optional model override, never a credential or endpoint. Reject an unknown connection ID; use the default only when the caller omits the ID. Resolve credentials against that connection's owner.

Model listing should be dynamic for both providers, with manual entry available. Normalize TypeSafe's `name` and OpenRouter's `id` into a common model option. Keep OpenRouter's input/output modalities, context length, and pricing when present. Keep unknown capabilities unknown. Do not select the first catalog model implicitly: the user chooses a model or a provider-specific suggested alias.

Any discovery cache must include the effective endpoint and credential/account identity without storing plaintext keys in cache identifiers. The current OpenRouter `fetchModelsWithMetadata` cache is keyed only by output modality; do not reuse it unchanged for configurable Decision connections. Unsaved model previews must not forward a saved credential to a different provider or endpoint implicitly.

The default **Test connection** action should perform authenticated discovery and report exactly what that checks. Offer a separate **Run sample decision** action with a small, valid request to verify the selected model and protocol. A malformed-input `400` or `422` must not count as a successful inference check. This differs from the existing STT test, which accepts `400` for its empty audio sample.

The initial extension surface should be:

```ts
interface SpindleDecisionsAPI {
  listProviders(options?: { userId?: string }): Promise<DecisionProviderDTO[]>
  listConnections(options?: { userId?: string }): Promise<DecisionConnectionProfileDTO[]>
  getConnection(id: string, options?: { userId?: string }): Promise<DecisionConnectionProfileDTO | null>
  getModels(id: string, options?: { userId?: string }): Promise<DecisionModelDTO[]>
  evaluate<Q extends Record<string, DecisionQuestion>>(
    input: {
      connection_id?: string // omitted means the user's default Decision connection
      model?: string         // omitted means the connection's saved model
      state: DecisionState
      questions: Q
      userId?: string        // required for operator extensions without user context
    },
    options?: { signal?: AbortSignal },
  ): Promise<DecisionResult<Q>>
}
```

These are proposed signatures. Export `DecisionQuestion`, `DecisionAnswer`, `DecisionConnectionProfileDTO`, `DecisionModelDTO`, and generic `DecisionAnswers<Q>` from `lumiverse-spindle-types`. Infer each answer's type from its question and preserve Choice option keys when callers provide literal criteria.

For example, an extension could choose a narrative handling path:

```ts
const result = await spindle.decisions.evaluate({
  connection_id: settings.decisionConnectionId,
  state: { latestMessage, sceneSummary },
  questions: {
    handling: {
      type: 'choice',
      instructions: 'Which handling path best fits the latest message?',
      criteria: {
        dialogue: 'Continue the conversation in the current scene.',
        transition: 'Move the story to a different scene.',
        clarify: 'Ask the user to clarify their intended action.',
      },
    },
    scene_change: {
      type: 'noul',
      instructions: 'Does the latest message explicitly request a scene change?',
    },
  },
})

const handling = result.answers.handling
if (handling.confidence >= settings.minimumConfidence) {
  await chooseHandlingPath(handling.choice)
}
```

Confidence thresholds belong to the extension or feature consuming the result. Preserve confidence separately from the selected option's probability. [TypeSafe confidence](https://docs.typesafe.ai/confidence). Return the resolved model, answers, provider request ID and serving provider when present, and usage without manufacturing absent token counts or costs. OpenRouter documents extra `id`, `provider`, and `usage.cost` fields. [OpenRouter response](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).

Add a dedicated **`decisions` permission** for connection inspection and evaluation. Check it on every host RPC through the current permission scope so revocation and delegated RPC policies work immediately. Reuse `resolveEffectiveUserId` and `enforceScopedUser`; a user extension cannot inspect or invoke another user's connections. Keep provider errors structured through the existing provider-error helpers, with bounded, redacted messages. Support cancellation and a bounded timeout; cancel outstanding evaluations when their worker terminates. Do not automatically retry ambiguous paid requests in the initial release.

The shared types, permission definitions, and namespace are included in the corrected `lumiverse-spindle-types` **0.6.45** build. A `prepack` hook rebuilds distribution files before packaging, and packed consumer tests check the Decision exports and runtime capability. The extension UI displays the Decisions permission, with REST and Spindle reference pages documenting the public API.

The concrete repository work is:

| Area | Files to add or extend |
| --- | --- |
| Persistence | Add the next sequential SQL migration for `decision_connections`; follow `src/db/migrations/069_stt_connections.sql` |
| Shared backend models | Add `src/types/decision-connection.ts` and `src/decision/types.ts` |
| Provider transport | Add a small provider interface and OpenRouter/TypeSafe adapters under `src/decision/`; reuse `src/utils/provider-errors.ts` |
| Connection management | Add `src/services/decision-connections.service.ts` using `stt-connections.service.ts` as the pattern |
| Evaluation | Add `src/services/decisions.service.ts` for connection resolution, credentials, validation, timeout, and dispatch |
| REST | Add `/api/v1/decision-connections` CRUD/model/key/test routes and `/api/v1/decisions/evaluate`; mount in `src/app.ts` |
| Worker bridge | Add `src/spindle/worker-host-decisions-api.ts`; extend host/runtime message unions, dispatch, and `spindle.decisions` in `worker-host.ts` and `worker-runtime.ts` |
| Permissions and SDK | Update public `lumiverse-spindle-types` DTOs, API, messages, validation, and permission metadata; update the dependency and local manager integration |
| Connections panel | Add `frontend/src/api/decision-connections.ts`, a Decision store slice, form/item/manager components, and a section in `frontend/src/lib/drawer-tab-registry.tsx` |
| Startup and state | Extend `src/services/bootstrap.service.ts`, `frontend/src/hooks/useAppInit.ts`, API/store types, store assembly, and connection-order normalization/settings application |
| Events | Add `DECISION_CONNECTION_CHANGED`; refresh Decision profiles across sessions and reconcile default changes across affected profiles |
| Account lifecycle | Extend `src/services/user-data/table-registry.ts` and `connection-secret-restore.ts` for export, import, purge, key scrubbing, and secret restoration |
| Documentation | Add REST, backend extension, permission, and user setup documentation; add translation strings and provider visuals |

First ship connection management, typed text/JSON evaluation, both providers, the public SDK update, and focused regression coverage together. A backend extension can expose its own frontend controls using the existing frontend/backend messaging bridge. Add a direct frontend Decision API only with explicit host permission enforcement; do not expose API keys in frontend code.

Multimodal evaluation is a separate follow-up because TypeSafe's current Jev catalog is text-only, while OpenRouter documents model-specific image formats and limits. Keep model input capabilities in the first model DTO so adding images does not require redesigning discovery. Extension-provided Decision providers can follow the existing registry as another follow-up: add broker kind `decision`, permission `providers.decision.register`, registry projections, and ownership/security tests. Consuming built-in Decision connections does not require provider registration. [TypeSafe input support](https://docs.typesafe.ai/models), [OpenRouter image contract](https://openrouter.ai/docs/guides/community/multimodal-decisions).

Acceptance checks should cover per-user CRUD and default uniqueness; readable/missing/duplicated credentials; TypeSafe and OpenRouter catalog formats; preservation of aliases and manually entered IDs; unsupported protocols; exact outbound URLs and auth; all three answer types; structured descriptions and null Choice criteria; missing/mismatched/invalid answers; provider authentication/credit/rate-limit failures; cancellation and timeout; permission denial/revocation/delegated scope; operator/user account isolation; bootstrap/order/event updates; and exports with credentials scrubbed. Run mocked provider tests by default. Verify real selected-model compatibility separately with authenticated sample decisions, recording both requested and resolved model IDs.
