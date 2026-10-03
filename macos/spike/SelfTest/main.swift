// Linux/macOS self-test for Shared/HandOff.swift (no Xcode needed):
//   swiftc -o /tmp/handoff-selftest Shared/HandOff.swift SelfTest/main.swift && /tmp/handoff-selftest
// Not part of either Xcode target (project.yml excludes it).
import Foundation

// `handoff-selftest --parse <url>` prints what the host app would log for that URL (used to check
// that test-handoff.sh's shell encoder and HandOff.parse agree).
if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "--parse" {
    guard let url = URL(string: CommandLine.arguments[2]), let req = HandOff.parse(url) else { print("UNPARSEABLE"); exit(1) }
    print(req.logBlock(at: Date(timeIntervalSince1970: 0)), terminator: "")
    exit(0)
}

var failures = 0
func check(_ ok: Bool, _ what: String) {
    if ok { print("ok   \(what)") } else { print("FAIL \(what)"); failures += 1 }
}

let nasty = [
    "/Users/me/Desktop/plain.txt",
    "/Users/me/Desktop/with space.txt",
    "/Users/me/Desktop/quote\"s 'single'.txt",
    "/Users/me/Desktop/-leading-dash.txt",
    "/Users/me/Desktop/ünïcödé 日本語 🚀.txt",
    "/Users/me/Desktop/a&b=c+d%20e#f?g.txt",
    "/Volumes/Some Drive/sub dir/x.txt",
]

let url = HandOff.url(ttl: "1h", paths: nasty)
check(url != nil, "url is built")
if let url {
    let req = HandOff.parse(url)
    check(req == HandOff.Request(ttl: "1h", paths: nasty), "round trip keeps every path and the ttl, in order")
    check(!url.absoluteString.contains(" "), "no raw spaces in the URL")
}
check(HandOff.parse(URL(string: "https://share?ttl=1h&path=%2Fa")!) == nil, "other schemes are ignored")
check(HandOff.parse(URL(string: "r2fl-spike://other?ttl=1h&path=%2Fa")!) == nil, "other hosts are ignored")
check(HandOff.parse(URL(string: "r2fl-spike://share?ttl=1h")!) == nil, "no paths is not a request")
check(HandOff.parse(URL(string: "r2fl-spike://share?path=%2Fa")!) == nil, "no ttl is not a request")
check(HandOff.parse(URL(string: "r2fl-spike://share?ttl=1d&path=%2Fa&bogus&x=1")!)
        == HandOff.Request(ttl: "1d", paths: ["/a"]), "unknown and malformed parts are skipped")

let req = HandOff.Request(ttl: "7d", paths: (1...7).map { "/d/f\($0).txt" })
check(req.summary == "would share 7 file(s) for 7d: f1.txt, f2.txt, f3.txt, f4.txt, f5.txt, +2 more", "summary truncates")
let block = HandOff.Request(ttl: "1h", paths: ["/x/a", "/x/b"]).logBlock(at: Date(timeIntervalSince1970: 0))
check(block == "1970-01-01T00:00:00Z ttl=1h count=2\n  1: /x/a\n  2: /x/b\n", "log block format")

exit(failures == 0 ? 0 : 1)
