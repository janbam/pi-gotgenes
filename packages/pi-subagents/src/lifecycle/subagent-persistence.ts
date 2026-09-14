/**
 * Durable parent-owned registry for resumable subagent conversations.
 *
 * Pi session state is global across `/tree`, so persisted records carry the
 * parent leaf visible at spawn and are filtered against the active ancestry on
 * every activation. The in-memory manager map is a cache of this registry, not
 * its source of truth.
 */

import type { JsonValue } from "@earendil-works/pi-coding-agent";
import type {
  SubagentStateSnapshot,
  SubagentStatus,
} from "#src/lifecycle/subagent-state";
import type { LifetimeUsage } from "#src/lifecycle/usage";
import type { ThinkingLevel } from "#src/types";

/** Stable session-state namespace owned by this extension. */
export const SUBAGENT_REGISTRY_KEY = "@gotgenes/pi-subagents";

const REGISTRY_VERSION = 1;

/** Serializable lifecycle and observation state needed after parent reopening. */
export type PersistedSubagentState = SubagentStateSnapshot;

/** Exact effective child-session inputs required to reopen an existing JSONL. */
export interface PersistedSubagentSession {
  outputFile: string;
  sessionId: string;
  sessionDir: string;
  effectiveCwd: string;
  systemPrompt: string;
  toolNames: string[];
  model?: { provider: string; id: string };
  thinkingLevel?: ThinkingLevel;
  agentMaxTurns?: number;
  parentContext?: string;
}

/** Provider-owned suspended workspace state, guarded by a stable provider ID. */
export interface PersistedWorkspace {
  providerId: string;
  state: JsonValue;
}

/** One durable child identity and everything needed to rediscover and resume it. */
export interface PersistedSubagentRecord {
  id: string;
  type: string;
  description: string;
  isBackground: boolean;
  toolCallId?: string;
  /** Parent conversation leaf visible at spawn; null means the session root. */
  parentEntryId: string | null;
  state: PersistedSubagentState;
  session?: PersistedSubagentSession;
  workspace?: PersistedWorkspace;
}

/** Durable reason an otherwise valid ID no longer has a resumable record. */
export interface PersistedSubagentTombstone {
  id: string;
  /** Preserve the deleted record's branch visibility boundary. */
  parentEntryId: string | null;
  reason: "deleted";
  deletedAt: number;
}

interface PersistedSubagentRegistry {
  version: typeof REGISTRY_VERSION;
  records: PersistedSubagentRecord[];
  tombstones: PersistedSubagentTombstone[];
}

/** Narrow parent-session storage and ancestry boundary used by the registry. */
export interface SubagentRegistrySession {
  getSessionState<T extends JsonValue = JsonValue>(key: string): T | undefined;
  getBranch(): unknown[];
}

/** Write side supplied by `ExtensionAPI.setSessionState`. */
export type SubagentRegistryWriter = (
  key: string,
  value: JsonValue | undefined,
) => void;

/** Result of decoding and ancestry-filtering the active parent registry. */
export type SubagentRegistryLoad =
  | {
      kind: "ready";
      records: PersistedSubagentRecord[];
      hiddenRecords: PersistedSubagentRecord[];
      tombstones: PersistedSubagentTombstone[];
      hiddenTombstones: PersistedSubagentTombstone[];
    }
  | { kind: "incompatible"; reason: string };

/** Decode the active parent registry and expose only records on its ancestry. */
export function loadSubagentRegistry(
  session: SubagentRegistrySession,
): SubagentRegistryLoad {
  const stored = session.getSessionState(SUBAGENT_REGISTRY_KEY);
  if (stored === undefined) {
    return {
      kind: "ready",
      records: [],
      hiddenRecords: [],
      tombstones: [],
      hiddenTombstones: [],
    };
  }

  // Reject unknown envelopes before inspecting records, so a newer writer is
  // never partially interpreted as this version's state.
  if (!isObject(stored) || typeof stored.version !== "number") {
    return { kind: "incompatible", reason: "registry envelope is malformed" };
  }
  if (stored.version !== REGISTRY_VERSION) {
    return {
      kind: "incompatible",
      reason: `unsupported registry version ${stored.version}`,
    };
  }
  if (!Array.isArray(stored.records)) {
    return { kind: "incompatible", reason: "registry records are malformed" };
  }

  const records: PersistedSubagentRecord[] = [];
  for (const [index, candidate] of stored.records.entries()) {
    if (!isPersistedRecord(candidate)) {
      return {
        kind: "incompatible",
        reason: `registry record ${index} is malformed`,
      };
    }
    records.push(candidate);
  }
  const tombstoneValues = stored.tombstones ?? [];
  if (!Array.isArray(tombstoneValues)) {
    return { kind: "incompatible", reason: "registry tombstones are malformed" };
  }
  const tombstones: PersistedSubagentTombstone[] = [];
  for (const [index, candidate] of tombstoneValues.entries()) {
    if (!isPersistedTombstone(candidate)) {
      return {
        kind: "incompatible",
        reason: `registry tombstone ${index} is malformed`,
      };
    }
    tombstones.push(candidate);
  }

  // Session state survives /tree navigation; the branch ancestry restores the
  // missing branch locality and prevents sibling records from leaking through.
  const ancestry = new Set(
    session
      .getBranch()
      .flatMap((entry) =>
        isObject(entry) && typeof entry.id === "string" ? [entry.id] : [],
      ),
  );
  const visible = records.filter(
    (candidate) =>
      candidate.parentEntryId === null || ancestry.has(candidate.parentEntryId),
  );
  const visibleIds = new Set(visible.map((candidate) => candidate.id));
  const visibleTombstones = tombstones.filter(
    (candidate) =>
      candidate.parentEntryId === null || ancestry.has(candidate.parentEntryId),
  );
  const visibleTombstoneIds = new Set(
    visibleTombstones.map((candidate) => candidate.id),
  );
  return {
    kind: "ready",
    records: visible,
    hiddenRecords: records.filter((candidate) => !visibleIds.has(candidate.id)),
    tombstones: visibleTombstones,
    hiddenTombstones: tombstones.filter(
      (candidate) => !visibleTombstoneIds.has(candidate.id),
    ),
  };
}

/** Replace the logical registry with one immediately durable versioned value. */
export function saveSubagentRegistry(
  write: SubagentRegistryWriter,
  records: readonly PersistedSubagentRecord[],
  tombstones: readonly PersistedSubagentTombstone[] = [],
): void {
  const registry: PersistedSubagentRegistry = {
    version: REGISTRY_VERSION,
    records: [...records],
    tombstones: [...tombstones],
  };
  write(SUBAGENT_REGISTRY_KEY, registry as unknown as JsonValue);
}

/** True when persisted JSON names one branch-scoped explicit deletion. */
function isPersistedTombstone(
  value: unknown,
): value is PersistedSubagentTombstone {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    (value.parentEntryId === null || typeof value.parentEntryId === "string") &&
    value.reason === "deleted" &&
    typeof value.deletedAt === "number"
  );
}

/** True when a decoded JSON value is one complete current-version record. */
function isPersistedRecord(value: unknown): value is PersistedSubagentRecord {
  if (!isObject(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.description !== "string" ||
    typeof value.isBackground !== "boolean" ||
    !isOptionalString(value.toolCallId) ||
    !(value.parentEntryId === null || typeof value.parentEntryId === "string") ||
    !isPersistedState(value.state)
  ) {
    return false;
  }
  if (value.session !== undefined && !isPersistedSession(value.session)) {
    return false;
  }
  if (value.workspace !== undefined && !isPersistedWorkspace(value.workspace)) {
    return false;
  }
  return true;
}

/** Validate the state fields read by hydration without accepting coercions. */
function isPersistedState(value: unknown): value is PersistedSubagentState {
  if (!isObject(value) || !isSubagentStatus(value.status)) return false;
  return (
    isOptionalString(value.result) &&
    isOptionalString(value.pendingQuestion) &&
    isOptionalString(value.workspaceNotice) &&
    isOptionalString(value.error) &&
    (value.stoppedWhileQueued === undefined ||
      typeof value.stoppedWhileQueued === "boolean") &&
    typeof value.startedAt === "number" &&
    isOptionalNumber(value.completedAt) &&
    isOptionalNumber(value.consumedAt) &&
    typeof value.toolUses === "number" &&
    isLifetimeUsage(value.lifetimeUsage) &&
    typeof value.compactionCount === "number" &&
    typeof value.turnCount === "number" &&
    typeof value.responseText === "string"
  );
}

/** Validate exact child activation values used by the reopen path. */
function isPersistedSession(value: unknown): value is PersistedSubagentSession {
  if (!isObject(value)) return false;
  return (
    typeof value.outputFile === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.sessionDir === "string" &&
    typeof value.effectiveCwd === "string" &&
    typeof value.systemPrompt === "string" &&
    Array.isArray(value.toolNames) &&
    value.toolNames.every((name) => typeof name === "string") &&
    (value.model === undefined || isModelIdentity(value.model)) &&
    (value.thinkingLevel === undefined ||
      typeof value.thinkingLevel === "string") &&
    isOptionalNumber(value.agentMaxTurns) &&
    isOptionalString(value.parentContext)
  );
}

/** Validate the provider guard and its opaque JSON payload. */
function isPersistedWorkspace(value: unknown): value is PersistedWorkspace {
  return (
    isObject(value) &&
    typeof value.providerId === "string" &&
    isJsonValue(value.state)
  );
}

/** Validate a model's durable provider/id identity. */
function isModelIdentity(value: unknown): value is { provider: string; id: string } {
  return (
    isObject(value) &&
    typeof value.provider === "string" &&
    typeof value.id === "string"
  );
}

/** Validate the token counters kept independently of the child transcript. */
function isLifetimeUsage(value: unknown): value is LifetimeUsage {
  return (
    isObject(value) &&
    typeof value.input === "number" &&
    typeof value.output === "number" &&
    typeof value.cacheWrite === "number"
  );
}

/** Runtime status union guard for untrusted persisted JSON. */
function isSubagentStatus(value: unknown): value is SubagentStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "steered" ||
    value === "aborted" ||
    value === "stopped" ||
    value === "error"
  );
}

/** Recursive JSON guard for opaque workspace state. */
function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

/** Object guard that excludes arrays and null. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Optional persisted string field guard. */
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Optional persisted finite-number field guard. */
function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value));
}
