import Cocoa

@main
final class LordMindsApp: NSObject, NSApplicationDelegate {
    static func main() {
        let app = NSApplication.shared
        let delegate = LordMindsApp()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let chromeURL = URL(fileURLWithPath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        let profilePath = NSHomeDirectory() + "/Library/Application Support/Lord Minds/Chrome"
        do {
            try FileManager.default.createDirectory(atPath: profilePath, withIntermediateDirectories: true)
            let chrome = Process()
            chrome.executableURL = chromeURL
            chrome.arguments = [
                "--app=http://localhost:3000",
                "--user-data-dir=\(profilePath)",
                "--no-first-run",
            ]
            try chrome.run()
            NSApp.terminate(nil)
        } catch {
            let alert = NSAlert()
            alert.messageText = "Could not open Lord Minds"
            alert.informativeText = "Make sure Google Chrome is installed and the local Lord Minds service is running.\n\n\(error.localizedDescription)"
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
        }
    }
}
