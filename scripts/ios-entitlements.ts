/** Honor the source app identity when a self-hosted user changes Apple teams. */
export function configureIOSBundleIdentity(spec: string, bundleId: string): string {
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId)) throw new Error("Invalid iOS bundle ID");
  const previous = (Bun.YAML.parse(spec) as any)?.settingGroups?.app?.base?.PRODUCT_BUNDLE_IDENTIFIER;
  if (previous !== bundleId) spec = configureIOSWidgetExtension(configureIOSPushEntitlements(spec, false), false);
  let matches = 0;
  const result = spec.replace(/^(      PRODUCT_BUNDLE_IDENTIFIER:)[^\n]*/gm, (_match, anchor: string) => {
    matches++; return `${anchor} ${bundleId}`;
  });
  if (matches !== 1) throw new Error("Missing or ambiguous iOS host bundle ID configuration");
  return result;
}

/** XcodeGen regenerates the plist from this specification on every build. */
export function configureIOSPushEntitlements(spec: string, enabled: boolean): string {
  const bundleId = (Bun.YAML.parse(spec) as any)?.settingGroups?.app?.base?.PRODUCT_BUNDLE_IDENTIFIER ?? "chat.lumiverse.ios";
  const activityGroup = `group.${bundleId}.activities`;
  const notificationKeychainGroup = `$(AppIdentifierPrefix)${bundleId}.notifications`;
  let matches = 0;
  const result = spec.replace(/(    entitlements:\n      path: lumiverse-ios-client_iOS\/lumiverse-ios-client_iOS.entitlements\n)((?:      properties:[^\n]*\n(?:        [^\n]*\n)*)*)/,
    (_match, path: string, blocks: string) => {
      matches++;
      const properties: Record<string, unknown> = {};
      for (const block of blocks.matchAll(/      properties:[^\n]*\n(?:        [^\n]*\n)*/g)) {
        const parsed = Bun.YAML.parse(block[0].replace(/^      /gm, "")) as { properties?: Record<string, unknown> };
        Object.assign(properties, parsed.properties || {});
      }
      if (enabled) {
        properties["aps-environment"] = "development";
        properties["com.apple.developer.usernotifications.communication"] = true;
        properties["com.apple.security.application-groups"] = [...new Set([
          ...((properties["com.apple.security.application-groups"] as string[] | undefined) ?? []), activityGroup,
        ])];
        properties["keychain-access-groups"] = [...new Set([
          ...((properties["keychain-access-groups"] as string[] | undefined) ?? []), notificationKeychainGroup,
        ])];
      } else {
        delete properties["aps-environment"];
        delete properties["com.apple.developer.usernotifications.communication"];
        const groups = ((properties["com.apple.security.application-groups"] as string[] | undefined) ?? []).filter(group => group !== activityGroup);
        if (groups.length) properties["com.apple.security.application-groups"] = groups;
        else delete properties["com.apple.security.application-groups"];
        const keychainGroups = ((properties["keychain-access-groups"] as string[] | undefined) ?? []).filter(group => group !== notificationKeychainGroup);
        if (keychainGroups.length) properties["keychain-access-groups"] = keychainGroups;
        else delete properties["keychain-access-groups"];
      }
      return `${path}      properties: ${JSON.stringify(properties)}\n`;
    });
  if (matches !== 1) throw new Error("The iOS project is missing its expected signing entitlement configuration.");
  return result;
}

/** Keep the service extension embedded and signed across XcodeGen regeneration. */
export function configureIOSNotificationExtension(spec: string, enabled: boolean): string {
  spec = spec.replace(/      # Lumiverse notification dependency\n[\s\S]*?      # End Lumiverse notification dependency\n/g, "")
    .replace(/      # Lumiverse notification sound\n[\s\S]*?      # End Lumiverse notification sound\n/g, "")
    .replace(/  # Lumiverse notification service\n[\s\S]*?  # End Lumiverse notification service\n/g, "");
  if (!enabled) return spec;
  const parsed = Bun.YAML.parse(spec) as {
    settingGroups: { app: { base: { PRODUCT_BUNDLE_IDENTIFIER: string } } };
    targets: Record<string, { info: { properties: { CFBundleShortVersionString: string | number; CFBundleVersion: string | number } } }>;
  };
  const bundleId = parsed.settingGroups.app.base.PRODUCT_BUNDLE_IDENTIFIER;
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId)) throw new Error("Invalid iOS bundle ID");
  const appInfo = parsed.targets["lumiverse-ios-client_iOS"]!.info.properties;
  const shortVersion = String(appInfo.CFBundleShortVersionString), buildVersion = String(appInfo.CFBundleVersion);
  if (![shortVersion, buildVersion].every(value => /^\d+(?:\.\d+){0,2}$/.test(value))) throw new Error("Invalid iOS application version");
  const anchor = "      - framework: libapp.a";
  if (!spec.includes(anchor)) throw new Error("Missing iOS application dependencies");
  const sourceAnchor = "      - path: lumiverse-ios-client_iOS";
  if (!spec.includes(sourceAnchor)) throw new Error("Missing iOS application sources");
  spec = spec.replace(sourceAnchor, `      # Lumiverse notification sound
      - path: ../../../../sounds
        buildPhase: resources
      # End Lumiverse notification sound
${sourceAnchor}`);
  spec = spec.replace(anchor, `      # Lumiverse notification dependency
      - target: LumiverseNotificationService
        embed: true
      # End Lumiverse notification dependency
${anchor}`);
  return spec + `
  # Lumiverse notification service
  LumiverseNotificationService:
    type: app-extension
    platform: iOS
    deploymentTarget: "15.0"
    sources:
      - path: ../../../../native/ios/Sources/NotificationSecurity.swift
      - path: ../../../../notification-service
        excludes: [PrivacyInfo.xcprivacy]
      - path: ../../../../notification-service/PrivacyInfo.xcprivacy
        buildPhase: resources
      - path: ../../../../sounds
        buildPhase: resources
    info:
      path: LumiverseNotificationService/Info.plist
      properties:
        CFBundleDisplayName: Lumiverse Notifications
        CFBundleShortVersionString: "$(MARKETING_VERSION)"
        CFBundleVersion: "$(CURRENT_PROJECT_VERSION)"
        NSUserActivityTypes: [INSendMessageIntent]
        LumiverseNotificationKeychainGroup: "$(AppIdentifierPrefix)${bundleId}.notifications"
        LumiverseNotificationBundleID: ${bundleId}
        LumiverseAPNsRelayURL: ${(Bun.YAML.parse(spec) as any).targets["lumiverse-ios-client_iOS"].info.properties.LumiverseAPNsRelayURL || "https://apn-relay.lumiverse.chat"}
        NSAppTransportSecurity: {NSAllowsArbitraryLoads: true}
        NSExtension:
          NSExtensionPointIdentifier: com.apple.usernotifications.service
          NSExtensionPrincipalClass: "$(PRODUCT_MODULE_NAME).NotificationService"
    entitlements:
      path: LumiverseNotificationService/LumiverseNotificationService.entitlements
      properties:
        keychain-access-groups: ["$(AppIdentifierPrefix)${bundleId}.notifications"]
    settings:
      groups: [app]
      base:
        PRODUCT_NAME: LumiverseNotificationService
        PRODUCT_BUNDLE_IDENTIFIER: ${bundleId}.NotificationService
        MARKETING_VERSION: "${shortVersion}"
        CURRENT_PROJECT_VERSION: "${buildVersion}"
        SWIFT_VERSION: "5.0"
        APPLICATION_EXTENSION_API_ONLY: YES
        SKIP_INSTALL: YES
  # End Lumiverse notification service
`;
}

/** An extension with a newer deployment target leaves the iOS 15 host usable. */
export function configureIOSLiveActivityExtension(spec: string, enabled: boolean): string {
  spec = spec.replace(/      # Lumiverse activity dependency\n[\s\S]*?      # End Lumiverse activity dependency\n/g, "")
    .replace(/      # Lumiverse activity intents\n[\s\S]*?      # End Lumiverse activity intents\n/g, "")
    .replace(/        # Lumiverse intent bridge\n[\s\S]*?        # End Lumiverse intent bridge\n/g, "")
    .replace(/  # Lumiverse live activity\n[\s\S]*?  # End Lumiverse live activity\n/g, "");
  if (!enabled) return spec;
  const parsed = Bun.YAML.parse(spec) as any;
  const bundleId = parsed.settingGroups.app.base.PRODUCT_BUNDLE_IDENTIFIER;
  const info = parsed.targets["lumiverse-ios-client_iOS"].info.properties;
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId)
    || ![info.CFBundleShortVersionString, info.CFBundleVersion].every(v => /^\d+(?:\.\d+){0,2}$/.test(String(v))))
    throw new Error("Invalid iOS application identity");
  const anchor = "      - framework: libapp.a";
  if (!spec.includes(anchor)) throw new Error("Missing iOS application dependencies");
  spec = spec.replace(anchor, `      # Lumiverse activity dependency
      - target: LumiverseLiveActivity
        embed: true
      # End Lumiverse activity dependency
${anchor}`);
  const sourcesAnchor = "      - path: lumiverse-ios-client_iOS";
  if (!spec.includes(sourcesAnchor)) throw new Error("Missing iOS application sources");
  spec = spec.replace(sourcesAnchor, `      # Lumiverse activity intents
      - path: ../../../../activity-intents
      # End Lumiverse activity intents
${sourcesAnchor}`);
  spec = spec.replace("        ENABLE_BITCODE:", `        # Lumiverse intent bridge
        SWIFT_OBJC_BRIDGING_HEADER: ../../../../activity-intents/LumiverseActivityActions.h
        # End Lumiverse intent bridge
        ENABLE_BITCODE:`);
  return spec + `
  # Lumiverse live activity
  LumiverseLiveActivity:
    type: app-extension
    platform: iOS
    deploymentTarget: "16.1"
    sources:
      - path: ../../../../live-activity
        excludes: [PrivacyInfo.xcprivacy]
      - path: ../../../../live-activity/PrivacyInfo.xcprivacy
        buildPhase: resources
      - ../../../../activity-intents
      - ../../../../native/ios/Sources/GenerationActivityAttributes.swift
      - ../../../../native/ios/Sources/GenerationActivityAvatar.swift
    entitlements:
      path: LumiverseLiveActivity/LumiverseLiveActivity.entitlements
      properties:
        com.apple.security.application-groups: [group.${bundleId}.activities]
    info:
      path: LumiverseLiveActivity/Info.plist
      properties:
        CFBundleDisplayName: Lumiverse
        LumiverseActivityAppGroup: group.${bundleId}.activities
        CFBundleShortVersionString: "$(MARKETING_VERSION)"
        CFBundleVersion: "$(CURRENT_PROJECT_VERSION)"
        NSExtension:
          NSExtensionPointIdentifier: com.apple.widgetkit-extension
    settings:
      groups: [app]
      base:
        PRODUCT_NAME: LumiverseLiveActivity
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: "$(inherited) LUMIVERSE_ACTIVITY_EXTENSION"
        PRODUCT_BUNDLE_IDENTIFIER: ${bundleId}.LiveActivity
        MARKETING_VERSION: "${info.CFBundleShortVersionString}"
        CURRENT_PROJECT_VERSION: "${info.CFBundleVersion}"
        SWIFT_VERSION: "5.0"
        APPLICATION_EXTENSION_API_ONLY: YES
        SKIP_INSTALL: YES
  # End Lumiverse live activity
`;
}

/** Widgets have their own App Group and work without APNs/Live Activities. */
export function configureIOSWidgetExtension(spec: string, enabled: boolean): string {
  spec = spec.replace(/      # Lumiverse widget dependency\n[\s\S]*?      # End Lumiverse widget dependency\n/g, "")
    .replace(/  # Lumiverse character widgets\n[\s\S]*?  # End Lumiverse character widgets\n/g, "");
  const parsed = Bun.YAML.parse(spec) as any;
  const bundleId = parsed.settingGroups?.app?.base?.PRODUCT_BUNDLE_IDENTIFIER ?? "chat.lumiverse.ios";
  const group = `group.${bundleId}.widgets`;
  let matches = 0;
  spec = spec.replace(/(    entitlements:\n      path: lumiverse-ios-client_iOS\/lumiverse-ios-client_iOS.entitlements\n)((?:      properties:[^\n]*\n(?:        [^\n]*\n)*)*)/,
    (_match, path: string, blocks: string) => {
      matches++;
      const properties: Record<string, unknown> = {};
      for (const block of blocks.matchAll(/      properties:[^\n]*\n(?:        [^\n]*\n)*/g)) {
        Object.assign(properties, (Bun.YAML.parse(block[0].replace(/^      /gm, "")) as any).properties || {});
      }
      const groups = ((properties["com.apple.security.application-groups"] as string[] | undefined) ?? []).filter(value => value !== group);
      if (enabled) groups.push(group);
      if (groups.length) properties["com.apple.security.application-groups"] = groups;
      else delete properties["com.apple.security.application-groups"];
      return `${path}      properties: ${JSON.stringify(properties)}\n`;
    });
  if (!enabled) return spec;
  if (matches !== 1) throw new Error("Missing iOS host entitlements for widgets");
  const info = parsed.targets["lumiverse-ios-client_iOS"]?.info.properties;
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId)
    || !info || ![info.CFBundleShortVersionString, info.CFBundleVersion].every(value => /^\d+(?:\.\d+){0,2}$/.test(String(value))))
    throw new Error("Invalid iOS widget application identity");
  const anchor = "      - framework: libapp.a";
  if (!spec.includes(anchor)) throw new Error("Missing iOS application dependencies");
  spec = spec.replace(anchor, `      # Lumiverse widget dependency
      - target: LumiverseWidgets
        embed: true
      # End Lumiverse widget dependency
${anchor}`);
  return spec + `
  # Lumiverse character widgets
  LumiverseWidgets:
    type: app-extension
    platform: iOS
    deploymentTarget: "16.0"
    sources:
      - path: ../../../../widgets
        excludes: [PrivacyInfo.xcprivacy]
      - path: ../../../../widgets/PrivacyInfo.xcprivacy
        buildPhase: resources
      - ../../../../native/ios/Sources/CharacterWidgetModel.swift
      - ../../../../native/ios/Sources/CharacterWidgetStore.swift
      - ../../../../native/ios/Sources/CharacterWidgetRefresh.swift
    entitlements:
      path: LumiverseWidgets/LumiverseWidgets.entitlements
      properties:
        com.apple.security.application-groups: [${group}]
        com.apple.developer.default-data-protection: NSFileProtectionComplete
    info:
      path: LumiverseWidgets/Info.plist
      properties:
        CFBundleDisplayName: Lumiverse Characters
        LumiverseWidgetAppGroup: ${group}
        CFBundleShortVersionString: "$(MARKETING_VERSION)"
        CFBundleVersion: "$(CURRENT_PROJECT_VERSION)"
        NSAppTransportSecurity: {NSAllowsArbitraryLoads: true}
        NSExtension:
          NSExtensionPointIdentifier: com.apple.widgetkit-extension
    settings:
      groups: [app]
      base:
        PRODUCT_NAME: LumiverseWidgets
        PRODUCT_BUNDLE_IDENTIFIER: ${bundleId}.Widgets
        MARKETING_VERSION: "${info.CFBundleShortVersionString}"
        CURRENT_PROJECT_VERSION: "${info.CFBundleVersion}"
        SWIFT_VERSION: "5.0"
        APPLICATION_EXTENSION_API_ONLY: YES
        SKIP_INSTALL: YES
  # End Lumiverse character widgets
`;
}
