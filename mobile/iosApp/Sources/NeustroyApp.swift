import SwiftUI
import UIKit
import UniformTypeIdentifiers
import AVFoundation
import Speech
import PDFKit
import CoreText
import UserNotifications
import NeustroyKit

@main
struct NeustroyMobileApp: App {
    private let services = NativeActions()
    var body: some Scene { WindowGroup { NativeScreen(services: services).ignoresSafeArea(.keyboard) } }
}
struct NativeScreen: UIViewControllerRepresentable {
    let services: NativeActions
    func makeUIViewController(context: Context) -> UIViewController { MainViewControllerKt.MainViewController(actions: services) }
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
final class NativeActions: NSObject, DeviceActions, UIDocumentPickerDelegate {
    private var importLimit = 5 * 1024 * 1024
    private var fileCallback: ((MobileFile?) -> Void)?
    private var player: AVPlayer?
    private let speaker = AVSpeechSynthesizer()
    private var audioEngine: AVAudioEngine?
    private var speechTask: SFSpeechRecognitionTask?
    private var loopObserver: NSObjectProtocol?
    private var presenter: UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var controller = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let next = controller?.presentedViewController { controller = next }
        return controller
    }
    private func data(_ bytes: KotlinByteArray) -> Data { Data((0..<bytes.size).map { UInt8(bitPattern: bytes.get(index: $0)) }) }
    private func bytes(_ data: Data) -> KotlinByteArray { let result = KotlinByteArray(size: Int32(data.count)); for (index, byte) in data.enumerated() { result.set(index: Int32(index), value: Int8(bitPattern: byte)) }; return result }
    func exportFile(file: MobileFile) {
        let name = URL(fileURLWithPath: file.name).lastPathComponent
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data(file.bytes).write(to: url, options: .atomic)
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = presenter?.view
            presenter?.present(sheet, animated: true)
        } catch { alert(error.localizedDescription) }
    }
    func exportPdf(title: String, text: String) {
        let page = CGRect(x: 0, y: 0, width: 595, height: 842)
        let content = (title + "\n\n" + String(text.prefix(200000))) as NSString
        let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 11), .foregroundColor: UIColor.black]
        let attributed = NSAttributedString(string: content as String, attributes: attributes)
        let framesetter = CTFramesetterCreateWithAttributedString(attributed)
        let data = UIGraphicsPDFRenderer(bounds: page).pdfData { context in
            var offset = 0
            while offset < content.length {
                context.beginPage()
                let canvas = context.cgContext
                canvas.saveGState(); canvas.translateBy(x: 0, y: 842); canvas.scaleBy(x: 1, y: -1)
                let path = CGPath(rect: CGRect(x: 44, y: 44, width: 507, height: 754), transform: nil)
                let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: offset, length: 0), path, nil)
                CTFrameDraw(frame, canvas); canvas.restoreGState()
                let count = CTFrameGetVisibleStringRange(frame).length
                if count == 0 { break }; offset += count
            }
        }
        exportFile(file: MobileFile(name: "neustroy.pdf", mime: "application/pdf", bytes: bytes(data)))
    }
    func importFile(maxBytes: Int32, done: @escaping (MobileFile?) -> Void) {
        importLimit = Int(maxBytes)
        fileCallback = done
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.delegate = self
        presenter?.present(picker, animated: true)
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { _ = fileCallback?(nil); fileCallback = nil }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { documentPickerWasCancelled(controller); return }
        do { let content = try Data(contentsOf: url); guard content.count <= importLimit else { throw NSError(domain: "neustroy", code: 1, userInfo: [NSLocalizedDescriptionKey: "Файл превышает лимит размера"]) }
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "text/plain"
            _ = fileCallback?(MobileFile(name: url.lastPathComponent, mime: type, bytes: bytes(content)))
        } catch { alert(error.localizedDescription); _ = fileCallback?(nil) }
        fileCallback = nil
    }
    func extractText(file: MobileFile, done: @escaping (String?, String?) -> Void) {
        if file.mime == "application/pdf" {
            guard let document = PDFDocument(data: data(file.bytes)), document.pageCount <= 40 else { _ = done(nil, "Не удалось прочитать PDF: максимум 40 страниц"); return }
            var text = document.string ?? ""
            for page in 0..<document.pageCount { for annotation in document.page(at: page)?.annotations ?? [] { if let value = annotation.widgetStringValue { text += "\n\(annotation.fieldName ?? ""): \(value)" } } }
            _ = done(String(text.prefix(50000)), nil)
        } else { _ = done(String(data: data(file.bytes), encoding: .utf8), nil) }
    }
    func openUrl(url: String) { if let target = URL(string: url), ["http", "https"].contains(target.scheme ?? "") { UIApplication.shared.open(target) } }
    func remind(id: String, title: String, start: String, done: @escaping (String?) -> Void) {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: start) ?? ISO8601DateFormatter().date(from: start)
        guard let date = date, date.timeIntervalSinceNow > 3600 else { _ = done("До встречи осталось меньше часа"); return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { allowed, error in
            guard allowed else { DispatchQueue.main.async { _ = done(error?.localizedDescription ?? "Разрешите уведомления") }; return }
            let content = UNMutableNotificationContent(); content.title = "Через час игра"; content.body = title; content.sound = .default
            let request = UNNotificationRequest(identifier: id, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: date.timeIntervalSinceNow - 3600, repeats: false))
            UNUserNotificationCenter.current().add(request) { error in DispatchQueue.main.async { _ = done(error?.localizedDescription) } }
        }
    }
    func dictate(done: @escaping (String?) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in DispatchQueue.main.async {
            guard status == .authorized, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ru-RU")), recognizer.isAvailable else { _ = done(nil); self.alert("Распознавание речи недоступно. Можно воспользоваться диктовкой клавиатуры."); return }
            do { let engine = AVAudioEngine(); self.audioEngine = engine
                let request = SFSpeechAudioBufferRecognitionRequest(); request.shouldReportPartialResults = true
                try AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: .duckOthers)
                let input = engine.inputNode; input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in request.append(buffer) }
                var text = ""
                self.speechTask = recognizer.recognitionTask(with: request) { result, _ in if let result = result { text = result.bestTranscription.formattedString } }
                try engine.start()
                let dialog = UIAlertController(title: "Диктовка", message: "Говорите, затем нажмите «Готово».", preferredStyle: .alert)
                func finish(_ value: String?) { engine.stop(); input.removeTap(onBus: 0); request.endAudio(); self.speechTask?.cancel(); self.audioEngine = nil; try? AVAudioSession.sharedInstance().setActive(false); _ = done(value) }
                dialog.addAction(UIAlertAction(title: "Готово", style: .default) { _ in finish(text) })
                dialog.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in finish(nil) })
                self.presenter?.present(dialog, animated: true)
            } catch { _ = done(nil); self.alert(error.localizedDescription) }
        } }
    }
    func playAudio(url: String, volume: Float, loop: Bool) {
        guard let target = URL(string: url), target.scheme == "https" else { return }
        stopAudio(); try? AVAudioSession.sharedInstance().setCategory(.playback)
        player = AVPlayer(url: target); player?.volume = volume
        if loop { loopObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: player?.currentItem, queue: .main) { [weak self] _ in self?.player?.seek(to: .zero); self?.player?.play() } }
        player?.play()
    }
    func stopAudio() { player?.pause(); player = nil; if let observer = loopObserver { NotificationCenter.default.removeObserver(observer) }; loopObserver = nil }
    func speak(text: String) { speaker.speak(AVSpeechUtterance(string: text)) }
    private func alert(_ text: String) { let dialog = UIAlertController(title: "neustroy", message: text, preferredStyle: .alert); dialog.addAction(UIAlertAction(title: "OK", style: .default)); presenter?.present(dialog, animated: true) }
}
