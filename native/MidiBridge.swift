//
//  MidiBridge.swift
//  MIDI Deck · Stream Deck MIDI helper
//
//  Publishes a *virtual* CoreMIDI source (no IAC bus, no Audio MIDI Setup
//  configuration) and forwards JSON commands read from stdin as MIDI events.
//  Any DAW / any CoreMIDI application sees the port as soon as it is created,
//  and it disappears automatically when the Stream Deck plugin stops.
//
//  Build (macOS + Xcode Command Line Tools): scripts/build-midi-bridge.sh
//
//  Protocol — one JSON object per line on stdin:
//    {"cmd":"noteOn","channel":1,"note":60,"velocity":100}
//    {"cmd":"noteOff","channel":1,"note":60,"velocity":0}
//    {"cmd":"cc","channel":1,"controller":7,"value":100}
//    {"cmd":"allNotesOff","channel":1}        // channel omitted = all channels
//    {"cmd":"panic"}
//    {"cmd":"raw","bytes":[144,60,100]}
//    {"cmd":"quit"}
//
//  Emits JSON lines on stdout:
//    {"event":"ready","name":"Stream Deck MIDI"}
//    {"event":"reconnected","name":"Stream Deck MIDI"}
//    {"event":"error","message":"..."}
//

import CoreMIDI
import Foundation

// MARK: - Output helpers

func writeLine(_ handle: FileHandle, _ text: String) {
    guard let data = (text + "\n").data(using: .utf8) else { return }
    handle.write(data)
}

func emit(_ message: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: message, options: []),
          let text = String(data: data, encoding: .utf8) else { return }
    writeLine(FileHandle.standardOutput, text)
}

func log(_ message: String) {
    writeLine(FileHandle.standardError, "midi-bridge: \(message)")
}

// MARK: - CoreMIDI state

var midiClient = MIDIClientRef()
var midiSource = MIDIEndpointRef()
var portName = "Stream Deck MIDI"

let stateLock = NSLock()
var sourceNeedsRecheck = false

func markNeedsRecheck() {
    stateLock.lock()
    sourceNeedsRecheck = true
    stateLock.unlock()
}

func takeNeedsRecheck() -> Bool {
    stateLock.lock()
    let value = sourceNeedsRecheck
    sourceNeedsRecheck = false
    stateLock.unlock()
    return value
}

// MARK: - Virtual source lifecycle

func createClient() -> Bool {
    let status = MIDIClientCreateWithBlock("MIDI Deck Client" as CFString, &midiClient) { notification in
        let messageID = notification.pointee.messageID
        if messageID == .msgSetupChanged || messageID == .msgObjectAdded || messageID == .msgObjectRemoved {
            markNeedsRecheck()
        }
    }
    if status != noErr {
        log("MIDIClientCreateWithBlock failed (\(status))")
        return false
    }
    return true
}

func createSource() -> Bool {
    let status = MIDISourceCreate(midiClient, portName as CFString, &midiSource)
    if status != noErr {
        log("MIDISourceCreate failed (\(status))")
        return false
    }
    _ = MIDIObjectSetStringProperty(midiSource, kMIDIPropertyManufacturer, "Rolltray" as CFString)
    _ = MIDIObjectSetStringProperty(midiSource, kMIDIPropertyModel, "Stream Deck MIDI Deck" as CFString)
    _ = MIDIObjectSetStringProperty(midiSource, kMIDIPropertyDisplayName, portName as CFString)
    return true
}

/// True while the virtual endpoint still exists in the MIDI server. The ref
/// becomes stale (kMIDIObjectNotFound) when coreaudiod restarts.
func sourceIsAlive() -> Bool {
    if midiSource == 0 { return false }
    var unmanagedName: Unmanaged<CFString>?
    let status = MIDIObjectGetStringProperty(midiSource, kMIDIPropertyName, &unmanagedName)
    if let unmanagedName = unmanagedName {
        _ = unmanagedName.takeRetainedValue()
    }
    return status == noErr
}

func recreateSourceIfNeeded() {
    if sourceIsAlive() { return }
    log("MIDI server changed, recreating virtual source")
    midiSource = 0
    if createSource() {
        emit(["event": "reconnected", "name": portName])
    } else {
        emit(["event": "error", "message": "could not recreate the virtual MIDI source"])
    }
}

// MARK: - Sending

func send(bytes: [UInt8]) {
    guard !bytes.isEmpty else { return }
    guard midiSource != 0 else {
        log("no MIDI source, dropping \(bytes)")
        return
    }

    let capacity = 512
    let raw = UnsafeMutableRawPointer.allocate(
        byteCount: capacity,
        alignment: MemoryLayout<MIDIPacketList>.alignment
    )
    defer { raw.deallocate() }

    let packetList = raw.bindMemory(to: MIDIPacketList.self, capacity: 1)
    let firstPacket = MIDIPacketListInit(packetList)

    let added: UnsafeMutablePointer<MIDIPacket>? = bytes.withUnsafeBufferPointer { buffer in
        guard let base = buffer.baseAddress else { return nil }
        return MIDIPacketListAdd(packetList, capacity, firstPacket, 0, bytes.count, base)
    }

    guard added != nil else {
        log("could not build the MIDI packet list")
        return
    }

    let status = MIDIReceived(midiSource, packetList)
    if status != noErr {
        log("MIDIReceived failed (\(status))")
    }
}

func clampByte(_ value: Int, min minimum: Int = 0, max maximum: Int = 127) -> UInt8 {
    let clamped = Swift.min(Swift.max(value, minimum), maximum)
    return UInt8(clamping: clamped)
}

func channelIndex(_ payload: [String: Any], default defaultChannel: Int) -> UInt8 {
    let raw = intValue(payload, "channel", default: defaultChannel)
    return UInt8(clamping: Swift.min(Swift.max(raw, 1), 16) - 1)
}

func intValue(_ payload: [String: Any], _ key: String, default value: Int) -> Int {
    if let number = payload[key] as? NSNumber { return number.intValue }
    if let number = payload[key] as? Int { return number }
    if let number = payload[key] as? Double { return Int(number) }
    return value
}

// MARK: - Command handling

func handle(line: String) {
    guard let data = line.data(using: .utf8),
          let parsed = try? JSONSerialization.jsonObject(with: data),
          let payload = parsed as? [String: Any],
          let command = payload["cmd"] as? String else {
        emit(["event": "error", "message": "invalid command line"])
        return
    }

    switch command {
    case "noteOn":
        let channel = channelIndex(payload, default: 1)
        let note = clampByte(intValue(payload, "note", default: 60))
        let velocity = clampByte(intValue(payload, "velocity", default: 100), min: 1)
        send(bytes: [0x90 | channel, note, velocity])

    case "noteOff":
        let channel = channelIndex(payload, default: 1)
        let note = clampByte(intValue(payload, "note", default: 60))
        let velocity = clampByte(intValue(payload, "velocity", default: 0))
        send(bytes: [0x80 | channel, note, velocity])

    case "cc":
        let channel = channelIndex(payload, default: 1)
        let controller = clampByte(intValue(payload, "controller", default: 1))
        let value = clampByte(intValue(payload, "value", default: 0))
        send(bytes: [0xB0 | channel, controller, value])

    case "allNotesOff":
        let anyChannel = payload["channel"] == nil
        let channels: [UInt8] = anyChannel ? (0...15).map { UInt8($0) } : [channelIndex(payload, default: 1)]
        for channel in channels {
            send(bytes: [0xB0 | channel, 123, 0]) // All Notes Off
            send(bytes: [0xB0 | channel, 64, 0])  // Sustain off
        }

    case "panic":
        for channel in UInt8(0)...UInt8(15) {
            send(bytes: [0xB0 | channel, 120, 0]) // All Sound Off
            send(bytes: [0xB0 | channel, 123, 0]) // All Notes Off
            send(bytes: [0xB0 | channel, 64, 0])  // Sustain off
        }

    case "raw":
        guard let values = payload["bytes"] as? [Any] else {
            emit(["event": "error", "message": "raw command needs a bytes array"])
            return
        }
        let bytes = values.map { clampByte(($0 as? NSNumber)?.intValue ?? 0, min: 0, max: 255) }
        send(bytes: bytes)

    case "quit":
        exit(0)

    default:
        emit(["event": "error", "message": "unknown command: \(command)"])
    }
}

// MARK: - Main

signal(SIGPIPE, SIG_IGN)

if CommandLine.arguments.count > 1 {
    let candidate = CommandLine.arguments[1].trimmingCharacters(in: .whitespacesAndNewlines)
    if !candidate.isEmpty { portName = candidate }
}

guard createClient() else {
    emit(["event": "error", "message": "could not create the MIDI client"])
    exit(1)
}

guard createSource() else {
    emit(["event": "error", "message": "could not create the virtual MIDI source"])
    exit(1)
}

emit(["event": "ready", "name": portName])

// stdin is read on a background queue so the main run loop stays free for the
// CoreMIDI notification callbacks and the health-check timer.
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { continue }
        handle(line: trimmed)
    }
    // stdin closed: the Stream Deck plugin is gone, so drop the virtual port.
    exit(0)
}

let healthCheck = Timer(timeInterval: 2.0, repeats: true) { _ in
    if takeNeedsRecheck() {
        recreateSourceIfNeeded()
    }
}
RunLoop.main.add(healthCheck, forMode: .common)
RunLoop.main.run()
