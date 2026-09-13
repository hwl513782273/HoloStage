// HoloStage — 3D 模型线框全息查看器（WKWebView + three.js 薄壳）
// macOS 12+ · swiftc 直编 · 单文件

import Cocoa
import WebKit

// MARK: - 自定义 scheme 文件服务（holo://f/<绝对路径>）
// WKWebView 禁止 JS 对 file:// 发 XHR/fetch，用 scheme handler 给 three.js 供字节

final class HoloSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let url = urlSchemeTask.request.url!
        // holo://f/<percent-encoded 绝对路径>
        guard url.absoluteString.hasPrefix("holo://f/") else {
            finishTask(urlSchemeTask, data: Data(), status: 404)
            return
        }
        var p = String(url.absoluteString.dropFirst("holo://f/".count))
        // 去掉可能的 ?query
        if let q = p.firstIndex(of: "?") { p = String(p[..<q]) }
        let path = p.removingPercentEncoding ?? p
        guard FileManager.default.fileExists(atPath: path),
              let data = FileManager.default.contents(atPath: path) else {
            finishTask(urlSchemeTask, data: Data(), status: 404)
            return
        }
        finishTask(urlSchemeTask, data: data, status: 200, path: path)
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func finishTask(_ task: WKURLSchemeTask, data: Data, status: Int, path: String? = nil) {
        let mime: String
        switch (path.map { URL(fileURLWithPath: $0 ).pathExtension.lowercased() } ?? "") {
        case "obj", "gltf", "json", "js": mime = "text/plain"
        default: mime = "application/octet-stream"
        }
        let rsp = HTTPURLResponse(url: task.request.url!, statusCode: status,
                                  httpVersion: "HTTP/1.1",
                                  headerFields: ["Content-Type": mime,
                                                 "Content-Length": String(data.count),
                                                 "Access-Control-Allow-Origin": "*"])!
        task.didReceive(rsp)
        task.didReceive(data)
        task.didFinish()
    }
}

// MARK: - 支持文件拖放的 WKWebView

final class DropWebView: WKWebView {
    var onFileDropped: ((URL) -> Void)?

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration)
        registerForDraggedTypes([.fileURL])
    }
    required init?(coder: NSCoder) { fatalError() }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        return draggedFileURL(sender) != nil ? .copy : []
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if let url = draggedFileURL(sender) {
            onFileDropped?(url)
            return true
        }
        return false
    }
    private func draggedFileURL(_ sender: NSDraggingInfo) -> URL? {
        guard let items = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self],
                options: [.urlReadingFileURLsOnly: true]) as? [URL],
              let url = items.first else { return nil }
        return url
    }
}

// MARK: - 品牌头

final class BrandHeader: NSView {
    private let version: String
    init(version: String) {
        self.version = version
        super.init(frame: NSRect(x: 0, y: 0, width: 1060, height: 44))
    }
    required init?(coder: NSCoder) { fatalError() }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let wnd = window, subviews.isEmpty else { return }
        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.frame = NSRect(x: 14, y: 5, width: 34, height: 34)
        icon.wantsLayer = true
        icon.layer?.cornerRadius = 8
        icon.layer?.masksToBounds = true

        let name = NSTextField(labelWithString: "HoloStage")
        name.font = .systemFont(ofSize: 15, weight: .bold)
        name.textColor = .labelColor
        name.frame = NSRect(x: 56, y: 13, width: 120, height: 20)

        let ver = NSTextField(labelWithString: "v" + version + " · 3D 全息线框加载台")
        ver.font = .systemFont(ofSize: 11)
        ver.textColor = .secondaryLabelColor
        ver.frame = NSRect(x: 172, y: 15, width: 260, height: 16)

        let about = NSButton(title: "关于", target: self, action: #selector(showAbout))
        about.bezelStyle = .recessed
        about.frame = NSRect(x: frame.width - 66, y: 10, width: 52, height: 24)
        about.autoresizingMask = .minXMargin

        addSubview(icon); addSubview(name); addSubview(ver); addSubview(about)
    }

    @objc private func showAbout() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "HoloStage",
            .applicationVersion: version,
            .version: version,
            .credits: NSAttributedString(string: "把 STL / OBJ / glTF / PLY / FBX / PMX\n变成复古未来风线框全息加载动画。\n渲染引擎 three.js r128（本地内置，离线可用）")
        ])
    }
}

// MARK: - AppDelegate

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: DropWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1060, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = "HoloStage"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = NSColor(calibratedRed: 0, green: 0, blue: 0, alpha: 1)
        window.minSize = NSSize(width: 720, height: 500)
        window.center()

        // 品牌头 + WebView 垂直布局
        let header = BrandHeader(version: version)
        header.translatesAutoresizingMaskIntoConstraints = false

        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "holo")
        cfg.setURLSchemeHandler(HoloSchemeHandler(), forURLScheme: "holo")
        webView = DropWebView(frame: .zero, configuration: cfg)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.setValue(false, forKey: "drawsBackground")
        webView.onFileDropped = { [weak self] url in
            self?.loadModel(at: url)
        }
        webView.navigationDelegate = self

        let content = NSView(frame: NSRect(x: 0, y: 0, width: 1060, height: 720))
        content.addSubview(header)
        content.addSubview(webView)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: content.topAnchor),
            header.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 44),
            webView.topAnchor.constraint(equalTo: header.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])
        window.contentView = content

        // 加载内置页面（读访问授权整个磁盘，让 JS 能 fetch 用户选择的模型文件）
        if let resURL = Bundle.main.resourceURL {
            let page = resURL.appendingPathComponent("web/index.html")
            webView.loadFileURL(page, allowingReadAccessTo: URL(fileURLWithPath: "/"))
        }

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: JS ↔ Swift

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "holo",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "openFile":
            pickAndLoad()
        case "droppedFile":
            pickAndLoad()
        case "saveGif":
            if let data = base64Data(body["data"]), let name = body["name"] as? String {
                saveData(data, name: name, ext: "gif")
            }
        case "savePng":
            if let data = base64Data(body["data"]), let name = body["name"] as? String {
                saveData(data, name: name, ext: "png")
            }
        case "savePngSeq":
            if let frames = body["frames"] as? [String], let name = body["name"] as? String {
                saveSequence(frames: frames, baseName: name)
            }
        default: break
        }
    }

    private func base64Data(_ any: Any?) -> Data? {
        guard let s = any as? String else { return nil }
        return Data(base64Encoded: s)
    }

    private func pickAndLoad() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.allowedFileTypes = ["stl", "obj", "gltf", "glb", "ply", "fbx", "pmx", "pmd"]
        panel.message = "选择 3D 模型文件（STL / OBJ / glTF / PLY / FBX / PMX）"
        panel.begin { [weak self] resp in
            guard resp == .OK, let url = panel.url else { return }
            self?.loadModel(at: url)
        }
    }

    private func loadModel(at url: URL) {
        // 转成 holo:// scheme URL，让 JS 侧 three.js loader 能 fetch 到字节
        let enc = url.path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? url.path
        let safeName = url.lastPathComponent.replacingOccurrences(of: "\"", with: "")
        let js = "window.holoLoadFile && window.holoLoadFile(\"holo://f/\(enc)\", \"\(safeName)\");"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func saveData(_ data: Data, name: String, ext: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.allowedFileTypes = [ext]
        panel.begin { resp in
            guard resp == .OK, let url = panel.url else { return }
            try? data.write(to: url)
        }
    }

    private func saveSequence(frames: [String], baseName: String) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.message = "选择 PNG 帧序列的保存文件夹"
        panel.begin { [weak self] resp in
            guard resp == .OK, let dir = panel.url else { return }
            DispatchQueue.global().async {
                for (i, b64) in frames.enumerated() {
                    guard let data = Data(base64Encoded: b64) else { continue }
                    let file = dir.appendingPathComponent(String(format: "%@_f%02d.png", baseName, i))
                    try? data.write(to: file)
                }
                DispatchQueue.main.async {
                    self?.webView.evaluateJavaScript(
                        "document.getElementById('status').textContent = 'PNG 序列已保存: \(dir.path.replacingOccurrences(of: "\\", with: "/"))';",
                        completionHandler: nil)
                }
            }
        }
    }
}

// 页面加载完成钩子（冒烟测试：HOLO_MODEL=/path/to/model 自动载入）
extension AppDelegate: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let p = ProcessInfo.processInfo.environment["HOLO_MODEL"] {
            loadModel(at: URL(fileURLWithPath: p))
        }
        if ProcessInfo.processInfo.environment["HOLO_DEBUG"] != nil {
            let dbg = """
            (function(){
              var s = document.getElementById('status');
              fetch('file:///tmp/holo_test_torus.obj').then(function(r){
                s.textContent = 'FETCH status=' + r.status + ' type=' + r.type;
              }).catch(function(e){ s.textContent = 'FETCH ERR ' + e; });
            })();
            """
            webView.evaluateJavaScript(dbg, completionHandler: nil)
        }
    }
}

// MARK: - main

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
