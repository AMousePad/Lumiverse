import { expect, test } from "bun:test";
import { configureIOSPushEntitlements, configureIOSNotificationExtension, configureIOSLiveActivityExtension } from "./ios-entitlements";

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
    if (enabled) {
      expect(parsed.targets.LumiverseNotificationService.settings.base.PRODUCT_BUNDLE_IDENTIFIER).toBe('chat.lumiverse.ios.NotificationService');
      expect(parsed.targets.LumiverseNotificationService.info.properties.NSExtension.NSExtensionPointIdentifier).toBe('com.apple.usernotifications.service');
      expect(parsed.targets.LumiverseNotificationService.settings.base.MARKETING_VERSION).toBe('1.2.3');
      expect(parsed.targets.LumiverseNotificationService.settings.base.CURRENT_PROJECT_VERSION).toBe('42');
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
    expect(parsed.targets['lumiverse-ios-client_iOS'].dependencies.filter((d: any) => d.target === 'LumiverseLiveActivity'))
      .toHaveLength(enabled ? 1 : 0);
    if (enabled) {
      expect(parsed.targets.LumiverseNotificationService).toBeDefined();
      expect(parsed.targets.LumiverseLiveActivity.deploymentTarget).toBe('16.1');
      expect(parsed.targets.LumiverseLiveActivity.settings.base.PRODUCT_BUNDLE_IDENTIFIER).toBe('chat.lumiverse.ios.LiveActivity');
      expect(parsed.targets.LumiverseLiveActivity.settings.base.CURRENT_PROJECT_VERSION).toBe('42');
      expect(parsed.targets.LumiverseLiveActivity.info.properties.NSExtension.NSExtensionPointIdentifier).toBe('com.apple.widgetkit-extension');
      expect(parsed.targets.LumiverseLiveActivity.sources).toContain('../../../../native/ios/Sources/GenerationActivityAttributes.swift');
      expect(parsed.targets.LumiverseLiveActivity.entitlements.properties['com.apple.security.application-groups']).toEqual(['group.chat.lumiverse.ios.activities']);
      expect(parsed.targets.LumiverseLiveActivity.info.properties.LumiverseActivityAppGroup).toBe('group.chat.lumiverse.ios.activities');
    }
  }
});
