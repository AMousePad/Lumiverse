import { expect, test } from "bun:test";
import { assertIOSPlatformEncryption, configureIOSDistribution, iosDistributionOptions, iosExportOptions } from "./ios-distribution";
import { configureIOSNotificationExtension, configureIOSLiveActivityExtension } from "./ios-entitlements";

test("the exempt encryption declaration cannot silently ship known bundled crypto providers", () => {
  expect(() => assertIOSPlatformEncryption("tauri v2.11.5\nreqwest v0.13.4\nsha2 v0.10.9")).not.toThrow();
  for (const name of ["rustls", "ring", "openssl", "aws-lc-rs", "aes", "chacha20poly1305"]) {
    expect(() => assertIOSPlatformEncryption(`tauri v2.11.5\n${name} v1.2.3\n${name} v1.2.3 (*)`)).toThrow(name);
  }
});

test("distribution requires explicit build identity and excludes experimental or development modes", () => {
  expect(iosDistributionOptions(["--app-store-connect", "--build-number", "42"]))
    .toEqual({ appStoreConnect: true, buildNumber: "42" });
  expect(iosDistributionOptions(["--build-number=1234.56.78"]).buildNumber).toBe("1234.56.78");
  expect(iosDistributionOptions([])).toEqual({ appStoreConnect: false, buildNumber: undefined });
  expect(() => iosDistributionOptions(["--app-store-connect"])).toThrow("explicit --build-number");
  for (const value of ["", "0", "-1", "1beta", "1.100", "10000", "1.2.3.4", "--push-notifications"]) {
    expect(() => iosDistributionOptions(["--build-number", value])).toThrow("--build-number must");
  }
  expect(() => iosDistributionOptions(["--build-number=1", "--build-number", "2"])).toThrow("once");
  for (const flag of ["--simulator", "--unsigned", "--debug", "--experimental-high-refresh"]) {
    expect(() => iosDistributionOptions(["--app-store-connect", "--build-number", "42", flag])).toThrow(flag);
  }
});

test("export stays local and permits external TestFlight while keeping the requested build number", () => {
  const appStore = iosExportOptions("ABCDEFGHIJ", { appStoreConnect: true, buildNumber: "42" });
  expect(appStore).toContain("<string>app-store-connect</string>");
  expect(appStore).toContain("<key>destination</key><string>export</string>");
  expect(appStore).toContain("<key>testFlightInternalTestingOnly</key><false/>");
  expect(appStore).toContain("<key>manageAppVersionAndBuildNumber</key><false/>");
  expect(iosExportOptions("ABCDEFGHIJ", { appStoreConnect: false })).toContain("<string>debugging</string>");
  expect(() => iosExportOptions("<invalid>", { appStoreConnect: true })).toThrow("Team ID");
});

test("regeneration updates all bundle versions, includes privacy resources, and resets development versions", () => {
  let spec = `settingGroups:
  app:
    base:
      PRODUCT_BUNDLE_IDENTIFIER: chat.lumiverse.ios
targets:
  lumiverse-ios-client_iOS:
    sources:
      - path: lumiverse-ios-client_iOS
      - path: LaunchScreen.storyboard
    settings:
      base:
        ENABLE_BITCODE: false
    info:
      properties:
        CFBundleShortVersionString: 0.1.0
        CFBundleVersion: "0.1.0"
    dependencies:
      - framework: libapp.a
`;
  for (const buildNumber of ["42", "43", undefined]) {
    spec = configureIOSNotificationExtension(spec, false);
    spec = configureIOSLiveActivityExtension(spec, false);
    spec = configureIOSDistribution(spec, "0.3.1", { appStoreConnect: !!buildNumber, buildNumber });
    spec = configureIOSNotificationExtension(spec, true);
    spec = configureIOSLiveActivityExtension(spec, true);
    const parsed = Bun.YAML.parse(spec) as any;
    const host = parsed.targets['lumiverse-ios-client_iOS'];
    expect(host.info.properties.CFBundleVersion).toBe(buildNumber ?? "0.3.1");
    expect(host.sources.filter((s: any) => s.path === '../../PrivacyInfo.xcprivacy'))
      .toEqual([{ path: '../../PrivacyInfo.xcprivacy', buildPhase: 'resources' }]);
    for (const target of ['LumiverseNotificationService', 'LumiverseLiveActivity']) {
      expect(parsed.targets[target].settings.base.CURRENT_PROJECT_VERSION).toBe(buildNumber ?? "0.3.1");
      expect(parsed.targets[target].settings.base.MARKETING_VERSION).toBe("0.3.1");
      expect(parsed.targets[target].sources.filter((s: any) => s?.path?.endsWith('/PrivacyInfo.xcprivacy'))).toHaveLength(1);
    }
  }
});
