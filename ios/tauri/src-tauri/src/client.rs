use tauri::Url;

pub fn normalize_server(value: &str, allow_insecure_http: bool) -> Result<Url, String> {
    if value.len() > 2048 { return Err("The server address is too long.".into()); }
    let url = Url::parse(value.trim()).map_err(|_| "Enter a complete server address, such as https://lumiverse.example.com.")?;
    let host = url.host_str().ok_or("The server address needs a hostname.")?;
    if url.scheme() != "https" && !(allow_insecure_http && url.scheme() == "http") {
        return Err("Use HTTPS, or enable Allow insecure HTTP for this server.".into());
    }
    if !url.username().is_empty() || url.password().is_some() || host.contains('*')
        || url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("Enter the server's origin only, without a username, password, path, query, or fragment.".into());
    }
    Url::parse(&format!("{}/", url.origin().ascii_serialization())).map_err(|error| error.to_string())
}

pub fn is_connection_page(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "https" && url.host_str() == Some("tauri.localhost"))
}

pub fn navigation_allowed(url: &Url, selected: Option<&Url>) -> bool {
    is_connection_page(url) || selected.is_some_and(|server| {
        matches!(url.scheme(), "http" | "https") && url.origin() == server.origin()
            && url.username().is_empty() && url.password().is_none()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_origins_without_losing_nondefault_ports() {
        assert_eq!(normalize_server(" https://EXAMPLE.com:443/ ", false).unwrap().as_str(), "https://example.com/");
        assert_eq!(normalize_server("https://example.com:8443", false).unwrap().as_str(), "https://example.com:8443/");
        assert_eq!(normalize_server("https://[::1]:8443", false).unwrap().as_str(), "https://[::1]:8443/");
    }
    #[test]
    fn refuses_credentials_paths_and_non_https_servers() {
        for value in ["http://example.com", "https://user:password@example.com", "https://example.com/app",
            "https://example.com?token=secret", "https://example.com#secret", "file:///etc/passwd",
            "javascript:alert(1)", "https://*.example.com"] {
            assert!(normalize_server(value, false).is_err(), "{value}");
        }
    }
    #[test]
    fn http_requires_explicit_permission_for_every_host() {
        for host in ["localhost", "127.0.0.1", "[::1]", "192.168.1.2", "server.local", "example.com"] {
            assert!(normalize_server(&format!("http://{host}:8080"), true).is_ok());
            assert!(normalize_server(&format!("http://{host}:8080"), false).is_err());
        }
        assert_eq!(normalize_server(" HTTP://EXAMPLE.com:80/ ", true).unwrap().as_str(), "http://example.com/");
        for value in ["http://user:secret@example.com", "http://example.com/path", "http://example.com?token=x", "file:///etc/passwd"] {
            assert!(normalize_server(value, true).is_err(), "{value}");
        }
    }
    #[test]
    fn navigation_stays_on_the_selected_origin_or_packaged_connection_screen() {
        let server = normalize_server("https://example.com:8443", false).unwrap();
        for value in ["https://example.com:8443/login", "https://example.com:8443/chats/one", "tauri://localhost/index.html?changeServer=1"] {
            assert!(navigation_allowed(&Url::parse(value).unwrap(), Some(&server)));
        }
        for value in ["https://example.com", "https://other.example.com:8443", "http://example.com:8443",
            "tauri://other/index.html", "https://tauri.localhost.evil.com", "file:///etc/passwd", "https://user@example.com:8443/"] {
            assert!(!navigation_allowed(&Url::parse(value).unwrap(), Some(&server)), "{value}");
        }
        assert!(!navigation_allowed(&server, None));
        let http = normalize_server("http://example.com:8080", true).unwrap();
        assert!(navigation_allowed(&Url::parse("http://example.com:8080/chat/one").unwrap(), Some(&http)));
        for value in ["http://other.example.com:8080", "http://example.com:8081", "https://example.com:8080"] {
            assert!(!navigation_allowed(&Url::parse(value).unwrap(), Some(&http)), "{value}");
        }
    }
}
