import Foundation
import Dispatch
import Darwin

final class FramedJSONConnection {
    private let socketFD: Int32
    private let handle: FileHandle
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private var readBuffer = Data()
    private var isClosed = false
    private let writeQueue = DispatchQueue(label: "mlx-host.socket.write")

    var onMessage: ((RPCEnvelope) -> Void)?
    var onClose: ((Error?) -> Void)?

    init(socketFD: Int32) {
        self.socketFD = socketFD
        self.handle = FileHandle(fileDescriptor: socketFD, closeOnDealloc: true)
    }

    func start() {
        handle.readabilityHandler = { [weak self] h in
            guard let self, !self.isClosed else { return }
            let data = h.availableData
            if data.isEmpty {
                self.stop()
                self.onClose?(nil)
                return
            }
            self.readBuffer.append(data)
            self.drainFrames()
        }
    }

    func stop() {
        guard !isClosed else { return }
        isClosed = true
        handle.readabilityHandler = nil
        close(socketFD)
    }

    func send(_ envelope: RPCEnvelope) {
        guard !isClosed else { return }
        do {
            let body = try encoder.encode(envelope)
            var frame = Data()
            var len = UInt32(body.count).bigEndian
            withUnsafeBytes(of: &len) { frame.append(contentsOf: $0) }
            frame.append(body)
            writeQueue.async { [weak self] in
                guard let self, !self.isClosed else { return }
                do {
                    try self.handle.write(contentsOf: frame)
                } catch {
                    self.stop()
                    self.onClose?(error)
                }
            }
        } catch {
            // Best effort: ignore.
        }
    }

    private func drainFrames() {
        while true {
            if readBuffer.count < 4 { return }
            let lenData = readBuffer.prefix(4)
            let length = lenData.withUnsafeBytes { ptr -> UInt32 in
                ptr.load(as: UInt32.self).bigEndian
            }
            let total = 4 + Int(length)
            if readBuffer.count < total { return }
            let body = readBuffer.subdata(in: 4..<total)
            readBuffer.removeSubrange(0..<total)

            do {
                let msg = try decoder.decode(RPCEnvelope.self, from: body)
                onMessage?(msg)
            } catch {
                // Ignore malformed frames.
            }
        }
    }
}


