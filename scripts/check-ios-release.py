#!/usr/bin/env python3
"""Inspect the actual app/IPA; App Store mode also verifies signatures and profiles.

This checks local packaging requirements, not Apple's review or live APNs delivery.
Only required-reason declarations are checked; data collection disclosures still
need to match the selected services and final App Store Connect privacy answers.
"""
import argparse
import datetime
import fnmatch
import json
import plistlib
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
from urllib.parse import urlsplit

PRIVATE_SELECTORS = (b"_setEnabled:forFeature:", b"_isEnabledForFeature:",
                     b"PreferPageRenderingUpdatesNear60FPSEnabled")
FILE_TIMESTAMP = "NSPrivacyAccessedAPICategoryFileTimestamp"
USER_DEFAULTS = "NSPrivacyAccessedAPICategoryUserDefaults"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_plist(path):
    require(path.is_file(), f"Missing {path.name} in {path.parent.name}")
    with path.open("rb") as stream:
        return plistlib.load(stream)


def check_manifest(path, expected):
    manifest = read_plist(path)
    entries = manifest.get("NSPrivacyAccessedAPITypes")
    require(isinstance(entries, list), f"Invalid required-reason declarations in {path}")
    reasons = {}
    for entry in entries:
        category = entry.get("NSPrivacyAccessedAPIType")
        values = entry.get("NSPrivacyAccessedAPITypeReasons")
        require(isinstance(category, str) and category not in reasons,
                f"Invalid or duplicate API category in {path}")
        require(isinstance(values, list) and values and all(isinstance(v, str) and v for v in values),
                f"Missing API reasons in {path}")
        reasons[category] = values
    for category, reason in expected.items():
        require(reason in reasons.get(category, []), f"Missing {category}/{reason} in {path}")


def command(argv):
    result = subprocess.run(argv, capture_output=True, timeout=60)
    require(result.returncode == 0,
            f"{Path(argv[0]).name} failed: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def check_icon_renditions(assets, icon_name):
    require(isinstance(assets, list), "Invalid compiled asset catalog")
    icons = [entry for entry in assets if entry.get("AssetType") == "Icon Image" and entry.get("Name") == icon_name]
    marketing = [entry for entry in icons if entry.get("Idiom") == "marketing"]
    require(marketing and all(entry.get("PixelWidth") == 1024 and entry.get("PixelHeight") == 1024 for entry in marketing),
            "Missing 1024x1024 marketing app icon in compiled asset catalog")
    for entry in icons:
        require(entry.get("Opaque") is True, f"App icon contains alpha/transparency: {entry.get('RenditionName', icon_name)}")


def check_compiled_app_icons(app, info):
    icon_name = info.get("CFBundleIcons", {}).get("CFBundlePrimaryIcon", {}).get("CFBundleIconName")
    require(isinstance(icon_name, str) and icon_name, "Missing primary app icon name")
    catalog = app / "Assets.car"
    require(catalog.is_file(), "Missing compiled app icon asset catalog")
    check_icon_renditions(json.loads(command(["/usr/bin/assetutil", "--info", str(catalog)])), icon_name)


def check_distribution_identity(info, entitlements, profile):
    bundle_id = info["CFBundleIdentifier"]
    require(not entitlements.get("get-task-allow"), f"Debug entitlement in {bundle_id}")
    granted = profile.get("Entitlements", {})
    require(not granted.get("get-task-allow") and not profile.get("ProvisionedDevices")
            and not profile.get("ProvisionsAllDevices"), f"Non-App-Store profile in {bundle_id}")
    expiry = profile.get("ExpirationDate")
    require(isinstance(expiry, datetime.datetime)
            and expiry.replace(tzinfo=datetime.timezone.utc) > datetime.datetime.now(datetime.timezone.utc),
            f"Expired or invalid provisioning profile in {bundle_id}")
    identity = entitlements.get("application-identifier", "")
    require(identity == granted.get("application-identifier") and identity.endswith("." + bundle_id),
            f"Signing/profile application identity mismatch in {bundle_id}")
    team = entitlements.get("com.apple.developer.team-identifier")
    require(team and team in profile.get("TeamIdentifier", []), f"Signing team mismatch in {bundle_id}")
    return team


def check_http_transport(info):
    # The selected server is runtime user input, shared by WebKit and URLSession.
    # These more specific keys make iOS ignore NSAllowsArbitraryLoads entirely.
    ats = info.get("NSAppTransportSecurity", {})
    require(ats.get("NSAllowsArbitraryLoads") is True and not any(key in ats for key in (
        "NSAllowsLocalNetworking", "NSAllowsArbitraryLoadsInWebContent", "NSAllowsArbitraryLoadsForMedia")),
        f"HTTP transport exception missing or overridden in {info.get('CFBundleIdentifier')}")


def check_notification_keychain(info, entitlements, profile, bundle_id):
    group = info.get("LumiverseNotificationKeychainGroup")
    prefixes = profile.get("ApplicationIdentifierPrefix", [])
    require(group in [prefix + "." + bundle_id + ".notifications" for prefix in prefixes],
            "Notification Keychain group does not match the provisioning prefix")
    require(group in entitlements.get("keychain-access-groups", []),
            "Missing shared notification Keychain signing entitlement")
    grants = profile.get("Entitlements", {}).get("keychain-access-groups", [])
    require(any(fnmatch.fnmatchcase(group, grant) for grant in grants),
            "Provisioning profile does not grant the notification Keychain group")


def inspect_app(app, *, bundle_id="chat.lumiverse.ios", version=None, build_number=None,
                push=False, native_cache=False, app_store=False, relay_url=None, widgets=False):
    info = read_plist(app / "Info.plist")
    require(info.get("CFBundleIdentifier") == bundle_id, "Unexpected host bundle identifier")
    require(info.get("ITSAppUsesNonExemptEncryption") is False,
            "Missing exempt encryption declaration; re-audit dependencies before changing it")
    if version is not None:
        require(info.get("CFBundleShortVersionString") == version, "Host version mismatch")
    if build_number is not None:
        require(info.get("CFBundleVersion") == build_number, "Host build number mismatch")
    require(info.get("LumiversePushEnabled", False) is push, "Host push build setting mismatch")
    require(info.get("NSSupportsLiveActivities", False) is push, "Host Live Activity setting mismatch")
    require(info.get("LumiverseWidgetsEnabled", False) is widgets, "Host widget setting mismatch")
    if widgets:
        require(info.get("LumiverseWidgetAppGroup") == "group." + bundle_id + ".widgets", "Host widget App Group mismatch")
        schemes = [scheme for entry in info.get("CFBundleURLTypes", []) for scheme in entry.get("CFBundleURLSchemes", [])]
        require("lumiverse" in schemes, "Missing widget URL scheme")
    require((app / "ios-native-cache-preview/manifest.json").is_file() is native_cache,
            "Bundled frontend setting mismatch")
    if app_store:
        check_compiled_app_icons(app, info)
    extensions = sorted((app / "PlugIns").glob("*.appex"))
    expected = {bundle_id + suffix for suffix in (".NotificationService", ".LiveActivity")} if push else set()
    if widgets:
        expected.add(bundle_id + ".Widgets")
    found = [read_plist(ext / "Info.plist").get("CFBundleIdentifier") for ext in extensions]
    require(set(found) == expected and len(found) == len(expected), "Missing or unexpected embedded extensions")
    if relay_url is not None:
        require(push, "Notification relay verification requires push notifications")
        url = urlsplit(relay_url)
        require(url.scheme == "https" and url.hostname and not url.username and not url.password
                and not url.path and not url.query and not url.fragment, "Relay URL must be an HTTPS origin")
        require(info.get("LumiverseAPNsRelayURL") == relay_url, "Host notification relay URL mismatch")
        group = info.get("LumiverseNotificationKeychainGroup")
        require(isinstance(group, str) and group.endswith("." + bundle_id + ".notifications") and "$(" not in group,
                "Missing or unresolved shared notification Keychain group")
        service = next(ext for ext in extensions if read_plist(ext / "Info.plist")["CFBundleIdentifier"]
                       == bundle_id + ".NotificationService")
        service_info = read_plist(service / "Info.plist")
        require(service_info.get("LumiverseAPNsRelayURL") == relay_url,
                "Notification extension relay URL mismatch")
        require(service_info.get("LumiverseNotificationKeychainGroup") == group,
                "Host and notification extension Keychain groups differ")
        require(service_info.get("LumiverseNotificationBundleID") == bundle_id,
                "Notification extension decryption bundle ID mismatch")
        require(not any(path.is_file() and path.suffix.lower() in (".p8", ".p12", ".pfx") for path in app.rglob("*")),
                "Private provider/signing key packaged in the app")
    bundles = [app, *extensions]
    teams = set()
    for bundle in bundles:
        child = read_plist(bundle / "Info.plist")
        if bundle == app or child["CFBundleIdentifier"].endswith((".Widgets", ".NotificationService")):
            check_http_transport(child)
        if child["CFBundleIdentifier"].endswith(".Widgets"):
            require(child.get("LumiverseWidgetAppGroup") == info.get("LumiverseWidgetAppGroup"), "Widget App Groups differ")
            require(child.get("NSExtension", {}).get("NSExtensionPointIdentifier") == "com.apple.widgetkit-extension", "Invalid widget extension point")
        require(child.get("CFBundleVersion") == info.get("CFBundleVersion")
                and child.get("CFBundleShortVersionString") == info.get("CFBundleShortVersionString"),
                f"Version mismatch in {bundle.name}")
        reasons = {FILE_TIMESTAMP: "C617.1", USER_DEFAULTS: "CA92.1"} if bundle == app else (
            {FILE_TIMESTAMP: "C617.1"} if child["CFBundleIdentifier"].endswith(".LiveActivity") else {})
        check_manifest(bundle / "PrivacyInfo.xcprivacy", reasons)
        executable = child.get("CFBundleExecutable")
        require(isinstance(executable, str) and Path(executable).name == executable,
                f"Invalid executable name in {bundle.name}")
        require((bundle / executable).is_file(), f"Missing executable in {bundle.name}")
        if app_store:
            command(["codesign", "--verify", "--strict", str(bundle)])
            entitlements = plistlib.loads(command(["codesign", "-d", "--entitlements", ":-", str(bundle)]))
            profile = plistlib.loads(command(["security", "cms", "-D", "-i", str(bundle / "embedded.mobileprovision")]))
            teams.add(check_distribution_identity(child, entitlements, profile))
            if relay_url is not None and (bundle == app or child["CFBundleIdentifier"].endswith(".NotificationService")):
                check_notification_keychain(child, entitlements, profile, bundle_id)
            if bundle == app:
                require(entitlements.get("aps-environment") == ("production" if push else None),
                        "Exported APNs environment must match the production push configuration")
                require(entitlements.get("com.apple.developer.usernotifications.communication", False) is push,
                        "Communication Notifications entitlement mismatch")
            if push and (bundle == app or child["CFBundleIdentifier"].endswith(".LiveActivity")):
                require("group." + bundle_id + ".activities" in entitlements.get("com.apple.security.application-groups", []),
                        f"Missing Live Activity App Group in {bundle.name}")
            if widgets and (bundle == app or child["CFBundleIdentifier"].endswith(".Widgets")):
                group = "group." + bundle_id + ".widgets"
                require(group in entitlements.get("com.apple.security.application-groups", []), f"Missing widget App Group in {bundle.name}")
                require(group in profile.get("Entitlements", {}).get("com.apple.security.application-groups", []), f"Widget App Group absent from provisioning profile in {bundle.name}")
                if bundle != app:
                    require(entitlements.get("com.apple.developer.default-data-protection") == "NSFileProtectionComplete", "Widget data protection mismatch")
    # Scan every packaged executable/library, not source files or only the host.
    for path in app.rglob("*"):
        if not path.is_file():
            continue
        with path.open("rb") as stream:
            magic = stream.read(4)
            if magic not in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"):
                continue
            binary = magic + stream.read()
        require(not any(selector in binary for selector in PRIVATE_SELECTORS),
                f"Experimental private WebKit API found in {path.name}")
    if app_store:
        require(len(teams) == 1, "Host and extensions must share a signing team")
        command(["codesign", "--verify", "--deep", "--strict", str(app)])
    return {"passed": True, "version": info["CFBundleShortVersionString"], "buildNumber": info["CFBundleVersion"],
            "bundles": [read_plist(b / "Info.plist")["CFBundleIdentifier"] for b in bundles],
            "appIconVerified": app_store,
            "usesNonExemptEncryption": info["ITSAppUsesNonExemptEncryption"],
            "notificationRelayURL": relay_url,
            "notificationKeychainSigningVerified": relay_url is not None and app_store,
            "distributionSigningVerified": app_store}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--bundle-id", default="chat.lumiverse.ios")
    parser.add_argument("--version")
    parser.add_argument("--build-number")
    parser.add_argument("--push-notifications", action="store_true")
    parser.add_argument("--widgets", action="store_true")
    parser.add_argument("--native-cache-preview", action="store_true")
    parser.add_argument("--app-store-connect", action="store_true")
    parser.add_argument("--notification-relay-url")
    args = parser.parse_args()
    require(not args.app_store_connect or (args.version and args.build_number),
            "Distribution verification requires --version and --build-number")
    options = dict(bundle_id=args.bundle_id, version=args.version, build_number=args.build_number,
                   push=args.push_notifications, native_cache=args.native_cache_preview, app_store=args.app_store_connect,
                   relay_url=args.notification_relay_url, widgets=args.widgets)
    if args.artifact.is_dir() and args.artifact.suffix == ".app":
        result = inspect_app(args.artifact, **options)
    else:
        require(args.artifact.is_file() and args.artifact.suffix == ".ipa", "Specify an existing .app or .ipa")
        with tempfile.TemporaryDirectory(prefix="lumiverse-ios-release-") as directory:
            # Reject unsafe paths before ditto extracts an archive.
            with zipfile.ZipFile(args.artifact) as archive:
                for entry in archive.infolist():
                    require(not Path(entry.filename).is_absolute() and ".." not in Path(entry.filename).parts,
                            "Unsafe IPA entry")
                    require((entry.external_attr >> 16) & 0o170000 != 0o120000, "IPA symlinks are unsupported")
            command(["ditto", "-x", "-k", str(args.artifact.resolve()), directory])
            apps = list((Path(directory) / "Payload").glob("*.app"))
            require(len(apps) == 1, "IPA must contain one host application")
            result = inspect_app(apps[0], **options)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, plistlib.InvalidFileException, zipfile.BadZipFile, subprocess.TimeoutExpired) as error:
        print(f"[ios] Release verification failed: {error}", file=sys.stderr)
        sys.exit(1)
