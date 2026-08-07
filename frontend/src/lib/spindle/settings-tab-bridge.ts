import { Puzzle } from 'lucide-react'
import type { SettingsSection, SettingsTabEntry } from '@/lib/settings-tab-registry'

const MAX_SETTINGS_TABS_PER_EXTENSION = 4
const MAX_SETTINGS_TABS = 32
const MAX_ID_LENGTH = 100
const MAX_STRING_LENGTH = 200
const MAX_KEYWORDS_PER_REGISTRATION = 32
const MAX_SECTIONS_PER_REGISTRATION = 64
const MAX_SECTION_KEYWORDS = 16

export interface SpindleSettingsTabSection {
  readonly key: string
  readonly titleKey: string
  readonly titleFallback: string
  readonly keywords: readonly string[]
}

export interface SpindleSettingsTabOptions {
  /** A shared tab id may belong to core or to another extension. */
  readonly id: string
  /** Metadata is ignored when a core tab owns this id. */
  readonly title?: string
  readonly shortName?: string
  readonly iconSvg?: string
  readonly description?: string
  readonly keywords?: readonly string[]
  readonly sections?: readonly SpindleSettingsTabSection[]
  /** Body order among registrants sharing a tab. Defaults to 100. */
  readonly order?: number
}

export interface ExtensionSettingsTabRegistrationInput {
  readonly registrationId: string
  readonly extensionId: string
  readonly options: SpindleSettingsTabOptions
}

export interface ExtensionSettingsTabRegistration {
  readonly registrationId: string
  readonly extensionId: string
  readonly tabId: string
  readonly title?: string
  readonly shortName?: string
  readonly iconSvg?: string
  readonly description?: string
  readonly keywords: readonly string[]
  readonly sections: readonly SpindleSettingsTabSection[]
  readonly order: number
  /** Monotonic host sequence; this is the dynamic metadata authority tie-breaker. */
  readonly sequence: number
}

export interface SettingsTabRegistrationHandle {
  readonly registrationId: string
  readonly tabId: string
  setTitle(title: string): void
  activate(): void
  destroy(): void
  onActivate(callback: () => void): () => void
}

/** Public placement handle returned by ctx.ui.registerSettingsTab. */
export interface SpindleSettingsTabHandle extends SettingsTabRegistrationHandle {
  readonly root: HTMLElement
}

export interface JoinedSettingsTabEntry extends SettingsTabEntry {
  iconSvg?: string
  sections?: SettingsSection[]
}

type RegistryListener = () => void

interface MutableRegistration {
  registrationId: string
  extensionId: string
  tabId: string
  title?: string
  shortName?: string
  iconSvg?: string
  description?: string
  keywords: string[]
  sections: SpindleSettingsTabSection[]
  order: number
  sequence: number
  activationHandlers: Set<() => void>
}

const registrationsById = new Map<string, MutableRegistration>()
const registrationIdsByTab = new Map<string, Set<string>>()
const registrationIdsByExtension = new Map<string, Set<string>>()
const registryListeners = new Set<RegistryListener>()
let registrationSequence = 0

function notifyRegistryListeners(): void {
  for (const listener of registryListeners) {
    try {
      listener()
    } catch {
      // An observer cannot prevent another extension from registering or tearing down.
    }
  }
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`SETTINGS_TAB_${field}_INVALID`)
  }
  return value.trim().slice(0, MAX_ID_LENGTH)
}

function optionalString(value: string | undefined, max = MAX_STRING_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

function stringList(values: readonly string[] | undefined, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(values)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim().slice(0, maxLength)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
    if (result.length >= maxItems) break
  }
  return result
}

function normalizeSections(sections: readonly SpindleSettingsTabSection[] | undefined): SpindleSettingsTabSection[] {
  if (!Array.isArray(sections)) return []
  const result: SpindleSettingsTabSection[] = []
  const seen = new Set<string>()
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue
    const key = optionalString(section.key, MAX_ID_LENGTH)
    const titleKey = optionalString(section.titleKey, MAX_STRING_LENGTH)
    const titleFallback = optionalString(section.titleFallback, MAX_STRING_LENGTH)
    if (!key || !titleKey || !titleFallback || seen.has(key)) continue
    seen.add(key)
    result.push({
      key,
      titleKey,
      titleFallback,
      keywords: stringList(section.keywords, MAX_SECTION_KEYWORDS, 100),
    })
    if (result.length >= MAX_SECTIONS_PER_REGISTRATION) break
  }
  return result
}

function sortRegistrations(registrations: readonly ExtensionSettingsTabRegistration[]): ExtensionSettingsTabRegistration[] {
  return [...registrations].sort((left, right) => left.order - right.order || left.sequence - right.sequence)
}

function snapshot(registration: MutableRegistration): ExtensionSettingsTabRegistration {
  return {
    registrationId: registration.registrationId,
    extensionId: registration.extensionId,
    tabId: registration.tabId,
    title: registration.title,
    shortName: registration.shortName,
    iconSvg: registration.iconSvg,
    description: registration.description,
    keywords: [...registration.keywords],
    sections: registration.sections.map((section) => ({ ...section, keywords: [...section.keywords] })),
    order: registration.order,
    sequence: registration.sequence,
  }
}

function registrationsForTab(tabId: string): ExtensionSettingsTabRegistration[] {
  const ids = registrationIdsByTab.get(tabId)
  if (!ids) return []
  const registrations: ExtensionSettingsTabRegistration[] = []
  for (const id of ids) {
    const registration = registrationsById.get(id)
    if (registration) registrations.push(snapshot(registration))
  }
  return sortRegistrations(registrations)
}

function mergedKeywords(
  base: readonly string[],
  registrations: readonly ExtensionSettingsTabRegistration[],
): string[] {
  const keywords = new Set(base)
  for (const registration of registrations) {
    for (const keyword of registration.keywords) keywords.add(keyword)
    for (const section of registration.sections) {
      for (const keyword of section.keywords) keywords.add(keyword)
    }
  }
  return [...keywords]
}

function mergedSections(
  base: readonly SettingsSection[] | undefined,
  registrations: readonly ExtensionSettingsTabRegistration[],
): SettingsSection[] {
  const sections = (base ?? []).map((section) => ({ ...section, keywords: [...section.keywords] }))
  for (const registration of registrations) {
    sections.push(...registration.sections.map((section) => ({ ...section, keywords: [...section.keywords] })))
  }
  return sections
}

function canViewCoreTab(tab: SettingsTabEntry, userRole?: string): boolean {
  if (!tab.role) return true
  if (tab.role === 'owner') return userRole === 'owner'
  return userRole === 'owner' || userRole === 'admin'
}

/** Register one extension body in the shared settings-tab registry. */
export function registerExtensionSettingsTab(
  input: ExtensionSettingsTabRegistrationInput,
): SettingsTabRegistrationHandle {
  const registrationId = requireNonEmpty(input.registrationId, 'REGISTRATION_ID')
  const extensionId = requireNonEmpty(input.extensionId, 'EXTENSION_ID')
  const tabId = requireNonEmpty(input.options.id, 'ID')
  if (registrationsById.has(registrationId)) {
    throw new Error(`SETTINGS_TAB_REGISTRATION_DUPLICATE:${registrationId}`)
  }

  const extensionRegistrations = registrationIdsByExtension.get(extensionId)
  if ((extensionRegistrations?.size ?? 0) >= MAX_SETTINGS_TABS_PER_EXTENSION) {
    throw new Error(`SETTINGS_TAB_LIMIT_PER_EXTENSION:${MAX_SETTINGS_TABS_PER_EXTENSION}`)
  }
  if (registrationsById.size >= MAX_SETTINGS_TABS) {
    throw new Error(`SETTINGS_TAB_LIMIT_GLOBAL:${MAX_SETTINGS_TABS}`)
  }

  const options = input.options
  const registration: MutableRegistration = {
    registrationId,
    extensionId,
    tabId,
    title: optionalString(options.title),
    shortName: optionalString(options.shortName, 64),
    iconSvg: optionalString(options.iconSvg, 8_192),
    description: optionalString(options.description),
    keywords: stringList(options.keywords, MAX_KEYWORDS_PER_REGISTRATION, 100),
    sections: normalizeSections(options.sections),
    order: Number.isFinite(options.order) ? options.order! : 100,
    sequence: ++registrationSequence,
    activationHandlers: new Set(),
  }

  registrationsById.set(registration.registrationId, registration)
  const tabRegistrations = registrationIdsByTab.get(registration.tabId) ?? new Set<string>()
  tabRegistrations.add(registration.registrationId)
  registrationIdsByTab.set(registration.tabId, tabRegistrations)
  const extensionIds = registrationIdsByExtension.get(registration.extensionId) ?? new Set<string>()
  extensionIds.add(registration.registrationId)
  registrationIdsByExtension.set(registration.extensionId, extensionIds)
  notifyRegistryListeners()

  let destroyed = false
  return {
    registrationId,
    tabId,
    setTitle(title: string): void {
      const normalized = requireNonEmpty(title, 'TITLE')
      if (destroyed) return
      const current = registrationsById.get(registrationId)
      if (!current || current.title === normalized) return
      current.title = normalized
      notifyRegistryListeners()
    },
    activate(): void {
      if (!destroyed) activateExtensionSettingsTab(tabId)
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      unregisterExtensionSettingsTab(registrationId)
    },
    onActivate(callback: () => void): () => void {
      if (destroyed) return () => undefined
      registration.activationHandlers.add(callback)
      return () => { registration.activationHandlers.delete(callback) }
    },
  }
}

export function unregisterExtensionSettingsTab(registrationId: string): void {
  const registration = registrationsById.get(registrationId)
  if (!registration) return
  registrationsById.delete(registrationId)

  const tabRegistrations = registrationIdsByTab.get(registration.tabId)
  tabRegistrations?.delete(registrationId)
  if (tabRegistrations?.size === 0) registrationIdsByTab.delete(registration.tabId)

  const extensionRegistrations = registrationIdsByExtension.get(registration.extensionId)
  extensionRegistrations?.delete(registrationId)
  if (extensionRegistrations?.size === 0) registrationIdsByExtension.delete(registration.extensionId)

  registration.activationHandlers.clear()
  notifyRegistryListeners()
}

export function activateExtensionSettingsTab(tabId: string): void {
  for (const registration of registrationsForTab(tabId)) {
    const live = registrationsById.get(registration.registrationId)
    if (!live) continue
    for (const handler of live.activationHandlers) {
      try { handler() } catch { /* extension callbacks are isolated */ }
    }
  }
}

export function subscribeExtensionSettingsTabs(listener: RegistryListener): () => void {
  registryListeners.add(listener)
  return () => { registryListeners.delete(listener) }
}

export function getExtensionSettingsTabRegistrations(tabId?: string): ExtensionSettingsTabRegistration[] {
  if (tabId !== undefined) return registrationsForTab(tabId)
  return sortRegistrations([...registrationsById.values()].map(snapshot))
}

export function hasExtensionSettingsTab(tabId: string): boolean {
  return registrationIdsByTab.has(tabId)
}

/**
 * Join live extension bodies into the role-filtered core registry. Core metadata
 * and role remain authoritative. A dynamic id uses its earliest live registrant
 * as metadata owner; bodies and search sections always follow order then sequence.
 */
export function joinExtensionSettingsTabs(
  coreTabs: readonly SettingsTabEntry[],
  userRole?: string,
  allCoreTabs: readonly SettingsTabEntry[] = coreTabs,
  hiddenRegistrationIds?: ReadonlySet<string>,
): JoinedSettingsTabEntry[] {
  const coreById = new Map(allCoreTabs.map((tab) => [tab.id, tab]))
  const visibleCoreIds = new Set(coreTabs.map((tab) => tab.id))
  const visibleRegistrationsFor = (tabId: string): ExtensionSettingsTabRegistration[] => {
    const registrations = registrationsForTab(tabId)
    if (!hiddenRegistrationIds?.size) return registrations
    return registrations.filter((registration) => !hiddenRegistrationIds.has(registration.registrationId))
  }

  const joined: JoinedSettingsTabEntry[] = []
  const seen = new Set<string>()
  for (const coreTab of coreTabs) {
    seen.add(coreTab.id)
    const registrations = visibleRegistrationsFor(coreTab.id)
    if (registrations.length === 0) {
      joined.push(coreTab)
      continue
    }
    joined.push({
      ...coreTab,
      keywords: mergedKeywords(coreTab.keywords, registrations),
      sections: mergedSections(coreTab.sections, registrations),
    })
  }

  for (const [tabId] of registrationIdsByTab) {
    if (seen.has(tabId)) continue
    const declaredCore = coreById.get(tabId)
    if (declaredCore) {
      // A role-hidden core tab cannot be revived by an extension claim.
      if (!visibleCoreIds.has(tabId) || !canViewCoreTab(declaredCore, userRole)) continue
      continue
    }

    const allRegistrations = registrationsForTab(tabId)
    const registrations = visibleRegistrationsFor(tabId)
    if (registrations.length === 0) continue
    const owner = allRegistrations.reduce((first, registration) =>
      registration.sequence < first.sequence ? registration : first
    )
    if (!owner) continue
    joined.push({
      id: tabId,
      shortName: owner.shortName ?? owner.title ?? tabId,
      tabName: owner.title ?? tabId,
      tabDescription: owner.description ?? `Open ${owner.title ?? tabId} extension settings`,
      tabIcon: Puzzle,
      iconSvg: owner.iconSvg,
      keywords: mergedKeywords([], registrations),
      component: () => null,
      sections: mergedSections(undefined, registrations),
    })
  }

  return joined
}

export const SETTINGS_TAB_LIMITS = {
  perExtension: MAX_SETTINGS_TABS_PER_EXTENSION,
  global: MAX_SETTINGS_TABS,
} as const
