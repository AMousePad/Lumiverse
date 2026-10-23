package chat.lumiverse.prototype;

public class NotificationPolicyCheck {
    static void equal(String actual, String expected) {
        if (!java.util.Objects.equals(actual, expected)) throw new AssertionError(actual + " != " + expected);
    }
    public static void main(String[] args) {
        equal(NotificationPolicy.origin("https://EXAMPLE.com:443/chat/abc?x=1"), "https://example.com");
        equal(NotificationPolicy.origin("http://127.0.0.1:7860/"), "http://127.0.0.1:7860");
        equal(NotificationPolicy.origin("http://[::1]:7860/chat/abc"), "http://[::1]:7860");
        equal(NotificationPolicy.origin("http://example.com:80"), "http://example.com");
        for (String invalid : new String[] { "javascript:alert(1)", "file:///x", "https://user:pass@example.com", "https://example.com:0", "//example.com" }) equal(NotificationPolicy.origin(invalid), null);
        equal(NotificationPolicy.chatPath("chat_abc-123"), "/chat/chat_abc-123");
        for (String invalid : new String[] { "../admin", "//external.example", "abc?x=1", "abc#hash", "a/b", "" }) equal(NotificationPolicy.chatPath(invalid), "/");
        if (!NotificationPolicy.tapOriginMatches("http://127.0.0.1:4100", "http://127.0.0.1:5200", true, true)) throw new AssertionError("Local runtime restart lost its tap");
        if (!NotificationPolicy.tapOriginMatches("https://example.com", "https://example.com", false, false)) throw new AssertionError("Remote tap lost its origin");
        for (boolean[] modes : new boolean[][] { {false, false}, {true, false}, {false, true} }) {
            if (NotificationPolicy.tapOriginMatches("http://127.0.0.1:4100", "http://127.0.0.1:5200", modes[0], modes[1])) throw new AssertionError("Cross-server tap accepted");
        }
        if (NotificationPolicy.tapOriginMatches("https://example.com", "https://other.example", false, false)
            || NotificationPolicy.tapOriginMatches("http://127.0.0.1:4100", "http://other.example:5200", true, true)) throw new AssertionError("External tap accepted");
    }
}
