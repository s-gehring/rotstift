use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use reqwest::Url;
use url::Host;

use super::ErrorClass;
use super::templates::{Api, Template};

#[derive(Debug, Clone)]
pub struct Endpoint {
    pub base: Url,
    pub host: String,
    pub loopback: bool,
    pub api: Api,
}

impl Endpoint {
    pub fn secure(&self) -> bool {
        self.base.scheme() == "https"
    }

    fn url(&self, tail: &[&str]) -> Url {
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map(|mut segments| {
                segments.pop_if_empty().extend(tail);
            })
            .ok();
        url
    }

    pub fn chat_url(&self) -> Url {
        match self.api {
            Api::Openai => self.url(&["chat", "completions"]),
            Api::Anthropic => self.url(&["messages"]),
        }
    }

    pub fn models_url(&self) -> Url {
        self.url(&["models"])
    }

    pub fn needs_pinning(&self) -> bool {
        !self.secure() || self.host == "localhost"
    }
}

pub fn normalize(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_owned()
}

pub fn parse(template: &Template, base_url: &str) -> Result<Endpoint, ErrorClass> {
    let normalized = normalize(base_url);
    if let Some(fixed) = &template.base_url
        && normalize(fixed) != normalized
    {
        return Err(ErrorClass::InvalidAddress);
    }
    let base = Url::parse(&normalized).map_err(|_| ErrorClass::InvalidAddress)?;
    let plain = base.username().is_empty()
        && base.password().is_none()
        && base.query().is_none()
        && base.fragment().is_none();
    if !plain {
        return Err(ErrorClass::InvalidAddress);
    }
    match base.scheme() {
        "https" => {}
        "http" if template.base_url.is_none() => {}
        "http" => return Err(ErrorClass::Insecure),
        _ => return Err(ErrorClass::InvalidAddress),
    }
    let (host, loopback) = match base.host() {
        Some(Host::Domain(name)) => {
            let name = name.to_ascii_lowercase();
            let loopback = name == "localhost";
            (name, loopback)
        }
        Some(Host::Ipv4(ip)) => (ip.to_string(), ip.is_loopback()),
        Some(Host::Ipv6(ip)) => (format!("[{ip}]"), ip.is_loopback()),
        None => return Err(ErrorClass::InvalidAddress),
    };
    Ok(Endpoint {
        base,
        host,
        loopback,
        api: template.api,
    })
}

fn private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || ip.is_private(),
        IpAddr::V6(ip) => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00,
    }
}

pub async fn pinned_addresses(endpoint: &Endpoint) -> Result<Vec<SocketAddr>, ErrorClass> {
    let port = endpoint
        .base
        .port_or_known_default()
        .ok_or(ErrorClass::InvalidAddress)?;
    if endpoint.host == "localhost" {
        return Ok(vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port)]);
    }
    let name = endpoint.host.trim_start_matches('[').trim_end_matches(']');
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((name, port))
        .await
        .map_err(|_| ErrorClass::Network)?
        .collect();
    if addresses.is_empty() {
        return Err(ErrorClass::Network);
    }
    if !endpoint.secure() && !addresses.iter().all(|address| private(address.ip())) {
        return Err(ErrorClass::Insecure);
    }
    Ok(addresses)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::templates::find;

    fn server(url: &str) -> Result<Endpoint, ErrorClass> {
        parse(find("server").unwrap(), url)
    }

    #[test]
    fn fixed_templates_only_accept_their_own_address() {
        let mistral = find("mistral").unwrap();
        let endpoint = parse(mistral, "https://api.mistral.ai/v1/").unwrap();
        assert_eq!(endpoint.host, "api.mistral.ai");
        assert!(!endpoint.loopback);
        assert_eq!(
            endpoint.chat_url().as_str(),
            "https://api.mistral.ai/v1/chat/completions"
        );
        assert_eq!(
            parse(mistral, "https://evil.example/v1").unwrap_err(),
            ErrorClass::InvalidAddress
        );
    }

    #[test]
    fn anthropic_talks_to_messages_and_models() {
        let anthropic = find("anthropic").unwrap();
        let endpoint = parse(anthropic, "https://api.anthropic.com/v1").unwrap();
        assert_eq!(
            endpoint.chat_url().as_str(),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            endpoint.models_url().as_str(),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            parse(anthropic, "http://api.anthropic.com/v1").unwrap_err(),
            ErrorClass::InvalidAddress
        );
    }

    #[test]
    fn own_servers_may_use_http_and_loopback_is_detected() {
        assert!(server("http://localhost:8080/v1").unwrap().loopback);
        assert!(server("http://127.0.0.2:8080/v1").unwrap().loopback);
        assert!(server("http://[::1]:8080/v1").unwrap().loopback);
        assert!(!server("http://192.168.1.10:8080/v1").unwrap().loopback);
        assert!(!server("https://ki.schule.example/v1").unwrap().loopback);
    }

    #[test]
    fn rejects_credentials_queries_and_other_schemes() {
        for url in [
            "http://user:pw@localhost/v1",
            "https://ki.example/v1?x=1",
            "https://ki.example/v1#frag",
            "ftp://ki.example/v1",
            "not a url",
        ] {
            assert_eq!(
                server(url).unwrap_err(),
                ErrorClass::InvalidAddress,
                "{url}"
            );
        }
    }

    #[tokio::test]
    async fn http_is_only_pinned_to_private_addresses() {
        let local = server("http://localhost:9/v1").unwrap();
        assert_eq!(
            pinned_addresses(&local).await.unwrap(),
            vec!["127.0.0.1:9".parse().unwrap()]
        );
        let lan = server("http://10.1.2.3:8080/v1").unwrap();
        assert!(pinned_addresses(&lan).await.is_ok());
        let public = server("http://8.8.8.8/v1").unwrap();
        assert_eq!(
            pinned_addresses(&public).await.unwrap_err(),
            ErrorClass::Insecure
        );
    }
}
