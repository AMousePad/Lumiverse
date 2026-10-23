import copy
import datetime
from pathlib import Path
import plistlib
import tempfile
import unittest

from importlib.util import module_from_spec, spec_from_file_location

spec = spec_from_file_location("check_ios_release", Path(__file__).with_name("check-ios-release.py"))
release = module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="lumiverse-release-test-")
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / "Lumiverse.app"
        self.info = {"CFBundleIdentifier": "chat.lumiverse.ios", "CFBundleExecutable": "Lumiverse",
                     "CFBundleVersion": "42", "CFBundleShortVersionString": "0.3.1",
                     "ITSAppUsesNonExemptEncryption": False,
                     "NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True}}
        self.bundle(self.app, self.info, {release.FILE_TIMESTAMP: "C617.1", release.USER_DEFAULTS: "CA92.1"})

    def write_plist(self, path, value):
        path.write_bytes(plistlib.dumps(value))

    def bundle(self, path, info, reasons):
        path.mkdir(parents=True)
        self.write_plist(path / "Info.plist", info)
        (path / info["CFBundleExecutable"]).write_bytes(b"\xcf\xfa\xed\xfe" + b"fake test executable")
        self.write_plist(path / "PrivacyInfo.xcprivacy", {"NSPrivacyAccessedAPITypes": [
            {"NSPrivacyAccessedAPIType": k, "NSPrivacyAccessedAPITypeReasons": [v]} for k, v in reasons.items()]})

    def check(self, **options):
        return release.inspect_app(self.app, version="0.3.1", build_number="42", **options)

    def test_valid_artifact_and_build_mismatch(self):
        self.assertTrue(self.check()["passed"])
        self.info["CFBundleVersion"] = "41"
        self.write_plist(self.app / "Info.plist", self.info)
        with self.assertRaisesRegex(ValueError, "build number mismatch"):
            self.check()

    def test_missing_required_reason(self):
        self.write_plist(self.app / "PrivacyInfo.xcprivacy", {"NSPrivacyAccessedAPITypes": []})
        with self.assertRaisesRegex(ValueError, "C617.1"):
            self.check()

    def test_encryption_declaration_is_preserved(self):
        for value in (None, True, "NO"):
            self.write_plist(self.app / "Info.plist", {**self.info, "ITSAppUsesNonExemptEncryption": value} if value is not None
                             else {k: v for k, v in self.info.items() if k != "ITSAppUsesNonExemptEncryption"})
            with self.assertRaisesRegex(ValueError, "exempt encryption declaration"):
                self.check()

    def test_private_selector_in_embedded_library(self):
        binary = self.app / "evil.dylib"
        binary.write_bytes(b"\xcf\xfa\xed\xfe" + release.PRIVATE_SELECTORS[0])
        with self.assertRaisesRegex(ValueError, "private WebKit API"):
            self.check()

    def test_compiled_marketing_icon_rejects_transparency_and_missing_renditions(self):
        icon = {"AssetType": "Icon Image", "Name": "AppIcon", "Idiom": "marketing", "Opaque": True,
                "PixelWidth": 1024, "PixelHeight": 1024, "RenditionName": "marketing.png"}
        release.check_icon_renditions([icon], "AppIcon")
        with self.assertRaisesRegex(ValueError, "alpha/transparency"):
            release.check_icon_renditions([{**icon, "Opaque": False}], "AppIcon")
        for assets in ([], [{**icon, "Name": "OtherIcon"}], [{**icon, "PixelWidth": 512}]):
            with self.assertRaisesRegex(ValueError, "1024x1024 marketing"):
                release.check_icon_renditions(assets, "AppIcon")
        with self.assertRaisesRegex(ValueError, "alpha/transparency"):
            release.check_icon_renditions([icon, {**icon, "Idiom": "phone", "PixelWidth": 180, "Opaque": False}], "AppIcon")

    def test_push_requires_both_versioned_extensions_and_manifest(self):
        self.info.update(LumiversePushEnabled=True, NSSupportsLiveActivities=True)
        self.write_plist(self.app / "Info.plist", self.info)
        with self.assertRaisesRegex(ValueError, "embedded extensions"):
            self.check(push=True)
        for suffix in ("NotificationService", "LiveActivity"):
            info = {**self.info, "CFBundleIdentifier": "chat.lumiverse.ios." + suffix}
            self.bundle(self.app / "PlugIns" / (suffix + ".appex"), info,
                        {release.FILE_TIMESTAMP: "C617.1"} if suffix == "LiveActivity" else {})
        self.assertTrue(self.check(push=True)["passed"])
        child = self.app / "PlugIns/LiveActivity.appex/Info.plist"
        info = plistlib.loads(child.read_bytes())
        info["CFBundleVersion"] = "41"
        self.write_plist(child, info)
        with self.assertRaisesRegex(ValueError, "Version mismatch"):
            self.check(push=True)

    def test_native_cache_must_match_request(self):
        with self.assertRaisesRegex(ValueError, "frontend setting mismatch"):
            self.check(native_cache=True)

    def test_http_transport_works_for_native_requests_as_well_as_web_views(self):
        release.check_http_transport(self.info)
        for ats in ({}, {"NSAllowsArbitraryLoadsInWebContent": True},
                    {"NSAllowsArbitraryLoads": True, "NSAllowsLocalNetworking": False},
                    {"NSAllowsArbitraryLoads": True, "NSAllowsArbitraryLoadsInWebContent": True}):
            with self.assertRaisesRegex(ValueError, "HTTP transport exception"):
                release.check_http_transport({**self.info, "NSAppTransportSecurity": ats})

    def test_widgets_are_independent_and_require_matching_group_scheme_and_version(self):
        self.info.update(LumiverseWidgetsEnabled=True, LumiverseWidgetAppGroup="group.chat.lumiverse.ios.widgets",
                         CFBundleURLTypes=[{"CFBundleURLSchemes": ["lumiverse"]}])
        self.write_plist(self.app / "Info.plist", self.info)
        with self.assertRaisesRegex(ValueError, "embedded extensions"):
            self.check(widgets=True)
        widget = self.app / "PlugIns/Widgets.appex"
        child = {**self.info, "CFBundleIdentifier": "chat.lumiverse.ios.Widgets",
                 "NSExtension": {"NSExtensionPointIdentifier": "com.apple.widgetkit-extension"}}
        self.bundle(widget, child, {})
        self.assertTrue(self.check(widgets=True)["passed"])
        child["LumiverseWidgetAppGroup"] = "group.other"
        self.write_plist(widget / "Info.plist", child)
        with self.assertRaisesRegex(ValueError, "App Groups differ"):
            self.check(widgets=True)
        child["LumiverseWidgetAppGroup"] = self.info["LumiverseWidgetAppGroup"]
        child["CFBundleVersion"] = "41"
        self.write_plist(widget / "Info.plist", child)
        with self.assertRaisesRegex(ValueError, "Version mismatch"):
            self.check(widgets=True)
        self.info["CFBundleURLTypes"] = []
        self.write_plist(self.app / "Info.plist", self.info)
        with self.assertRaisesRegex(ValueError, "widget URL scheme"):
            self.check(widgets=True)

    def test_distribution_profiles_reject_development_ad_hoc_and_expiry(self):
        entitlements = {"application-identifier": "TEAM.chat.lumiverse.ios", "com.apple.developer.team-identifier": "TEAM"}
        profile = {"Entitlements": {"application-identifier": "TEAM.chat.lumiverse.ios"}, "TeamIdentifier": ["TEAM"],
                   "ExpirationDate": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)}
        self.assertEqual(release.check_distribution_identity(self.info, entitlements, profile), "TEAM")
        for change in ({"ProvisionedDevices": ["test-device"]}, {"ProvisionsAllDevices": True},
                       {"ExpirationDate": datetime.datetime(2020, 1, 1)},
                       {"Entitlements": {"get-task-allow": True}}):
            with self.assertRaises(ValueError):
                release.check_distribution_identity(self.info, entitlements, {**copy.deepcopy(profile), **change})
        with self.assertRaisesRegex(ValueError, "Debug entitlement"):
            release.check_distribution_identity(self.info, {**entitlements, "get-task-allow": True}, profile)


if __name__ == "__main__":
    unittest.main()
