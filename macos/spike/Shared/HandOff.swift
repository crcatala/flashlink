import Foundation

/// The hand-off between the Finder Sync extension and the host app: one custom-scheme URL,
///
///     r2fl-spike://share?ttl=1h&path=%2FUsers%2Fme%2Fa%20b.txt&path=...
///
/// Every value is percent-encoded byte by byte, so file names with spaces, quotes, `&`, `=`, `+`,
/// unicode or a leading dash survive unchanged. Nothing here touches a shell. This file is compiled
/// into both targets and only uses Foundation, so it can be tested on Linux (see ../test-handoff.sh).
enum HandOff {
    static let scheme = "r2fl-spike"
    static let host = "share"

    struct Lifetime {
        let label: String
        let ttl: String
    }

    static let lifetimes: [Lifetime] = [
        Lifetime(label: "15 minutes", ttl: "15m"),
        Lifetime(label: "1 hour", ttl: "1h"),
        Lifetime(label: "1 day", ttl: "1d"),
        Lifetime(label: "7 days", ttl: "7d"),
    ]

    struct Request: Equatable {
        var ttl: String
        var paths: [String]

        /// "would share 2 file(s) for 1h: a.txt, b.txt"
        var summary: String {
            let names = paths.prefix(5).map { ($0 as NSString).lastPathComponent }.joined(separator: ", ")
            let more = paths.count > 5 ? ", +\(paths.count - 5) more" : ""
            return "would share \(paths.count) file(s) for \(ttl): \(names)\(more)"
        }

        /// One block for the host app's log file: a header line, then one line per path in order.
        /// ../test-handoff.sh compares these lines byte for byte.
        func logBlock(at date: Date) -> String {
            var lines = ["\(ISO8601DateFormatter().string(from: date)) ttl=\(ttl) count=\(paths.count)"]
            for (i, p) in paths.enumerated() { lines.append("  \(i + 1): \(p)") }
            return lines.joined(separator: "\n") + "\n"
        }
    }

    private static let unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    private static func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    }

    static func url(ttl: String, paths: [String]) -> URL? {
        var s = "\(scheme)://\(host)?ttl=\(encode(ttl))"
        for p in paths { s += "&path=\(encode(p))" }
        return URL(string: s)
    }

    /// nil when the URL is not a share request or carries no path.
    static func parse(_ url: URL) -> Request? {
        guard url.scheme == scheme, url.host == host,
              let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery
        else { return nil }
        var ttl: String?
        var paths: [String] = []
        for part in query.split(separator: "&", omittingEmptySubsequences: true) {
            let kv = part.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard kv.count == 2, let value = String(kv[1]).removingPercentEncoding else { continue }
            switch kv[0] {
            case "ttl": ttl = value
            case "path": paths.append(value)
            default: break
            }
        }
        guard let ttl, !ttl.isEmpty, !paths.isEmpty else { return nil }
        return Request(ttl: ttl, paths: paths)
    }
}
