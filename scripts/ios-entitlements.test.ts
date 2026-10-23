import { expect, test } from "bun:test";
import { configureIOSBundleIdentity, configureIOSPushEntitlements, configureIOSNotificationExtension, configureIOSLiveActivityExtension, configureIOSWidgetExtension } from "./ios-entitlements";

test("self-built IPAs replace the generated host identity and signing groups together", () => {
  let spec = `settingGroups:
  app:
    base:
      PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios
targets:
  app:
    entitlements:
      path: lumiverse-ios-client_iOS/lumiverse-ios-client_iOS.entitlements
      properties:
        keychain-access-groups: [other.group, "$(AppIdentifierPrefix)chat.lumiverse.ios.notifications"]
        com.apple.security.application-groups: [group.other, group.chat.lumiverse.ios.activities]
        aps-environment: development
  SmokeTests:
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios.smoke
  CacheTests:
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios.cache-integration
`;
  spec = configureIOSPushEntitlements(configureIOSBundleIdentity(spec, "chat.example.custom"), true);
  const parsed = Bun.YAML.parse(spec) as any;
  expect(parsed.settingGroups.app.base.PRODUCT_BUNDLE_IDENTIFIER).toBe("chat.example.custom");
  expect(parsed.targets.app.entitlements.properties["keychain-access-groups"])
    .toEqual(["other.group", "$(AppIdentifierPrefix)chat.example.custom.notifications"]);
  expect(parsed.targets.app.entitlements.properties["com.apple.security.application-groups"])
    .toEqual(["group.other", "group.chat.example.custom.activities"]);
  expect(parsed.targets.SmokeTests.settings.base.PRODUCT_BUNDLE_IDENTIFIER).toBe("chat.lumiverse.ios.smoke");
  expect(parsed.targets.CacheTests.settings.base.PRODUCT_BUNDLE_IDENTIFIER).toBe("chat.lumiverse.ios.cache-integration");
});

test("push signing survives project regeneration and can be removed for Personal Teams", () => {
  let spec = `targets:
  app:
    entitlements:
      path: lumiverse-ios-client_iOS/lumiverse-ios-client_iOS.entitlements
    settings:
      base:
        PRODUCT_NAME: Lumiverse
`;
  for (const enabled of [true, true, false, false, true, false]) {
    spec = configureIOSPushEntitlements(spec, enabled);
    const parsed = Bun.YAML.parse(spec) as { targets: { app: { entitlements: { properties: Record<string, unknown> } } } };
    expect(parsed.targets.app.entitlements.properties).toEqual(enabled ? {
      "aps-environment": "development", "com.apple.developer.usernotifications.communication": true,
      "com.apple.security.application-groups": ["group.chat.lumiverse.ios.activities"],
      "keychain-access-groups": ["$(AppIdentifierPrefix)chat.lumiverse.ios.notifications"],
    } : {});
    expect(spec.match(/      properties:/g)).toHaveLength(1);
    expect(spec).toContain("PRODUCT_NAME: Lumiverse");
  }
});

test("push builds embed one notification extension and ordinary builds remove it", () => {
  let spec = `name: test
settingGroups:
  app:
    base:
      PRODUCT_NAME: Lumiverse
      PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios
targets:
  lumiverse-ios-client_iOS:
    sources:
      - path: lumiverse-ios-client_iOS
    info:
      properties:
        CFBundleShortVersionString: "1.2.3"
        CFBundleVersion: "42"
    dependencies:
      - framework: libapp.a
        embed: false
`;
  for (const enabled of [true, true, false, false, true]) {
    spec = configureIOSNotificationExtension(spec, enabled);
    const parsed = Bun.YAML.parse(spec) as any;
    expect(!!parsed.targets.LumiverseNotificationService).toBe(enabled);
    expect(parsed.targets['lumiverse-ios-client_iOS'].dependencies.filter((d: any) => d.target === 'LumiverseNotificationService'))
      .toHaveLength(enabled ? 1 : 0);
    expect(parsed.targets['lumiverse-ios-client_iOS'].sources.filter((s: any) => s.path === '../../../../sounds'))
      .toEqual(enabled ? [{ path: '../../../../sounds', buildPhase: 'resources' }] : []);
    if (enabled) {
      expect(parsed.targets.LumiverseNotificationService.settings.base.PRODUCT_BUNDLE_IDENTIFIER).toBe('chat.lumiverse.ios.NotificationService');
      expect(parsed.targets.LumiverseNotificationService.info.properties.NSExtension.NSExtensionPointIdentifier).toBe('com.apple.usernotifications.service');
      expect(parsed.targets.LumiverseNotificationService.info.properties.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: true });
      expect(parsed.targets.LumiverseNotificationService.settings.base.MARKETING_VERSION).toBe('1.2.3');
      expect(parsed.targets.LumiverseNotificationService.settings.base.CURRENT_PROJECT_VERSION).toBe('42');
      expect(parsed.targets.LumiverseNotificationService.sources).toContainEqual({ path: '../../../../sounds', buildPhase: 'resources' });
    }
  }
});

test("toggling push preserves other signing capabilities", () => {
  const spec = `    entitlements:
      path: lumiverse-ios-client_iOS/lumiverse-ios-client_iOS.entitlements
      properties:
        keychain-access-groups: [other.group]
        com.apple.security.application-groups: [group.other, group.chat.lumiverse.ios.activities]
        aps-environment: development
    settings: {}
`;
  const parsed = Bun.YAML.parse(configureIOSPushEntitlements(spec, false)) as { entitlements: { properties: Record<string, unknown> } };
  expect(parsed.entitlements.properties).toEqual({ "keychain-access-groups": ["other.group"], "com.apple.security.application-groups": ["group.other"] });
});

test("Live Activities embed and sign alongside communication notifications, preserving iOS 15 host support", () => {
  let spec = `settingGroups:
  app:
    base:
      PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios
targets:
  lumiverse-ios-client_iOS:
    deploymentTarget: "15.0"
    sources:
      - path: lumiverse-ios-client_iOS
    settings:
      base:
        ENABLE_BITCODE: false
    info:
      properties:
        CFBundleShortVersionString: "1.2.3"
        CFBundleVersion: "42"
    dependencies:
      - framework: libapp.a
`;
  for (const enabled of [true, true, false, false, true]) {
    spec = configureIOSNotificationExtension(spec, enabled);
    spec = configureIOSLiveActivityExtension(spec, enabled);
    const parsed = Bun.YAML.parse(spec) as any;
    expect(parsed.targets['lumiverse-ios-client_iOS'].deploymentTarget).toBe('15.0');
    expect(!!parsed.targets.LumiverseLiveActivity).toBe(enabled);
    expect(parsed.targets['lumiverse-ios-client_iOS'].sources.filter((s: any) => s.path === '../../../../activity-intents')).toHaveLength(enabled ? 1 : 0);
    expect(parsed.targets['lumiverse-ios-client_iOS'].settings.base.SWIFT_OBJC_BRIDGING_HEADER)
      .toBe(enabled ? '../../../../activity-intents/LumiverseActivityActions.h' : undefined);
    expect(parsed.targets['lumiverse-ios-client_iOS'].dependencies.filter((d: any) => d.target === 'LumiverseLiveActivity'))
      .toHaveLength(enabled ? 1 : 0);
    if (enabled) {
      expect(parsed.targets.LumiverseNotificationService).toBeDefined();
      expect(parsed.targets.LumiverseLiveActivity.deploymentTarget).toBe('16.1');
      expect(parsed.targets.LumiverseLiveActivity.settings.base.PRODUCT_BUNDLE_IDENTIFIER).toBe('chat.lumiverse.ios.LiveActivity');
      expect(parsed.targets.LumiverseLiveActivity.settings.base.CURRENT_PROJECT_VERSION).toBe('42');
      expect(parsed.targets.LumiverseLiveActivity.info.properties.NSExtension.NSExtensionPointIdentifier).toBe('com.apple.widgetkit-extension');
      expect(parsed.targets.LumiverseLiveActivity.sources).toContain('../../../../native/ios/Sources/GenerationActivityAttributes.swift');
      expect(parsed.targets.LumiverseLiveActivity.sources).toContain('../../../../activity-intents');
      expect(parsed.targets.LumiverseLiveActivity.settings.base.SWIFT_ACTIVE_COMPILATION_CONDITIONS).toContain('LUMIVERSE_ACTIVITY_EXTENSION');
      expect(parsed.targets.LumiverseLiveActivity.entitlements.properties['com.apple.security.application-groups']).toEqual(['group.chat.lumiverse.ios.activities']);
      expect(parsed.targets.LumiverseLiveActivity.info.properties.LumiverseActivityAppGroup).toBe('group.chat.lumiverse.ios.activities');
    }
  }
});

test("widgets embed independently of push, retain host iOS 15 support, and regenerate idempotently", () => {
  let spec = `settingGroups:
  app:
    base:
      PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios
targets:
  lumiverse-ios-client_iOS:
    deploymentTarget: "15.0"
    sources:
      - path: lumiverse-ios-client_iOS
    entitlements:
      path: lumiverse-ios-client_iOS/lumiverse-ios-client_iOS.entitlements
      properties: {com.apple.security.application-groups: [group.other]}
    settings:
      base:
        ENABLE_BITCODE: false
    info:
      properties:
        CFBundleShortVersionString: "1.2.3"
        CFBundleVersion: "42"
    dependencies:
      - framework: libapp.a
`;
  for (const push of [false, true, false]) {
    spec = configureIOSPushEntitlements(spec, push);
    spec = configureIOSNotificationExtension(spec, push);
    spec = configureIOSLiveActivityExtension(spec, push);
    for (const enabled of [true, true, false, false, true]) {
      spec = configureIOSWidgetExtension(spec, enabled);
      const parsed = Bun.YAML.parse(spec) as any;
      const host = parsed.targets['lumiverse-ios-client_iOS'];
      expect(host.deploymentTarget).toBe('15.0');
      expect(host.dependencies.filter((d: any) => d.target === 'LumiverseWidgets')).toHaveLength(enabled ? 1 : 0);
      expect(!!parsed.targets.LumiverseWidgets).toBe(enabled);
      expect(!!parsed.targets.LumiverseLiveActivity).toBe(push);
      expect(host.entitlements.properties['aps-environment']).toBe(push ? 'development' : undefined);
      const groups = host.entitlements.properties['com.apple.security.application-groups'];
      expect(groups.includes('group.other')).toBe(true);
      expect(groups.filter((g: string) => g.endsWith('.widgets'))).toEqual(enabled ? ['group.chat.lumiverse.ios.widgets'] : []);
      if (enabled) {
        expect(parsed.targets.LumiverseWidgets.deploymentTarget).toBe('16.0');
        expect(parsed.targets.LumiverseWidgets.settings.base.CURRENT_PROJECT_VERSION).toBe('42');
        expect(parsed.targets.LumiverseWidgets.info.properties.LumiverseWidgetAppGroup).toBe('group.chat.lumiverse.ios.widgets');
        expect(parsed.targets.LumiverseWidgets.info.properties.NSAppTransportSecurity).toEqual({ NSAllowsArbitraryLoads: true });
        expect(parsed.targets.LumiverseWidgets.entitlements.properties['com.apple.developer.default-data-protection']).toBe('NSFileProtectionComplete');
      }
    }
  }
  spec = configureIOSBundleIdentity(spec, 'chat.example.custom');
  spec = configureIOSWidgetExtension(spec, true);
  const parsed = Bun.YAML.parse(spec) as any;
  expect(parsed.targets.LumiverseWidgets.settings.base.PRODUCT_BUNDLE_IDENTIFIER).toBe('chat.example.custom.Widgets');
  expect(parsed.targets['lumiverse-ios-client_iOS'].entitlements.properties['com.apple.security.application-groups'])
    .toEqual(['group.other', 'group.chat.example.custom.widgets']);
});
