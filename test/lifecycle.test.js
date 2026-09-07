const net = require("net");
const assert = require("assert");

console.log("Starting lifecycle and dual-output tests for Vantage nodes...\n");

// Mock Node-RED RED object
const registeredTypes = {};
const nodeInstances = {};

const RED = {
    nodes: {
        registerType: function (type, constructor) {
            registeredTypes[type] = constructor;
        },
        createNode: function (node, config) {
            node.id = config.id || "test-" + Math.random().toString(36).substr(2, 9);
            node.type = config.type;
            node.name = config.name;
            node.status = function (s) { node._lastStatus = s; };
            node.log = function (m) { };
            node.warn = function (m) { };
            node.error = function (m) { };
            node.send = function (msg) {
                if (node._sendCallback) node._sendCallback(msg);
            };
            node.on = function (event, handler) {
                node._events = node._events || {};
                node._events[event] = handler;
            };
            node.emit = function (event, ...args) {
                if (node._events && node._events[event]) {
                    node._events[event](...args);
                }
            };
            nodeInstances[node.id] = node;
        },
        getNode: function (id) {
            return nodeInstances[id];
        }
    }
};

// Load nodes
require("../vantage-controller.js")(RED);
require("../vantage-infusion-mqtt.js")(RED);

assert.ok(registeredTypes["vantage-controller"], "vantage-controller must be registered");
assert.ok(registeredTypes["vantage-infusion-mqtt"], "vantage-infusion-mqtt must be registered");
console.log("  [PASS] Both node types successfully registered");

// Setup a mock Vantage TCP Server
const TEST_PORT = 13001;
const receivedFromClient = [];
let clientSocket = null;

const server = net.createServer((socket) => {
    clientSocket = socket;
    socket.setEncoding("utf8");

    socket.on("data", (data) => {
        const lines = data.split(/\r\n|\r|\n/).filter(Boolean);
        for (const line of lines) {
            receivedFromClient.push(line);
            if (line === "VERSION") {
                socket.write("R:VERSION 3.2.0 InFusion\r\n");
            }
        }
    });
});

server.listen(TEST_PORT, "127.0.0.1", () => {
    // 1. Create Controller Config Node
    const controllerConfig = {
        id: "controller-1",
        host: "127.0.0.1",
        port: TEST_PORT,
        keepalive: 0,
        pacing: 10,
        debug: false
    };
    const controllerNode = new registeredTypes["vantage-controller"](controllerConfig);

    // 2. Create Main Bridge Node
    const bridgeConfig = {
        id: "bridge-1",
        controller: "controller-1",
        load: "120",
        blind: "55",
        sync_startup: false,
        watchdog: false,
        mqtt_discovery: true,
        discovery_prefix: "homeassistant"
    };

    const receivedOutputs = [];
    const bridgeNode = new registeredTypes["vantage-infusion-mqtt"](bridgeConfig);
    bridgeNode._sendCallback = function (msg) {
        receivedOutputs.push(msg);
    };

    // Wait for connection
    setTimeout(() => {
        assert.ok(controllerNode.connected, "Controller should be connected");
        console.log("  [PASS] Controller connected to mock Vantage TCP server");

        // Verify startup subscription commands were sent
        assert.ok(receivedFromClient.includes("STATUS LOAD"), "Should have sent STATUS LOAD");
        assert.ok(receivedFromClient.includes("STATUS BTN"), "Should have sent STATUS BTN");
        assert.ok(receivedFromClient.includes("VERSION"), "Should have sent VERSION");
        console.log("  [PASS] Startup subscription commands sent upon connect");

        // Verify connection status message
        const connStatusMsg = receivedOutputs.find(o => o && o[0] && o[0].topic === "connection/vantage/status");
        assert.ok(connStatusMsg, "Should have published connection/vantage/status");
        const connStatusPayload = JSON.parse(connStatusMsg[0].payload);
        assert.strictEqual(connStatusPayload.state, "ON");
        assert.strictEqual(connStatusPayload.attributes.manufacturer, "Vantage Controls");
        assert.strictEqual(connStatusPayload.attributes.powered_by, "Bruno Leonardi");
        assert.strictEqual(connStatusPayload.attributes.function, "Connection status");
        console.log("  [PASS] Connection status ON with signature published on connect");

        // Verify discovery messages published on connect
        const discoveryMsgs = receivedOutputs.filter(o => o && o[0] && o[0].topic && o[0].topic.includes("/config"));
        assert.ok(discoveryMsgs.length > 0, "Should have published HA discovery messages");
        console.log("  [PASS] Home Assistant Discovery messages published on connect");

        // Test incoming event from Vantage -> Dual Output
        receivedOutputs.length = 0; // clear
        clientSocket.write("R:LOAD 120 100\r\n");

        setTimeout(() => {
            assert.ok(receivedOutputs.length >= 2, "Should have received connection status and load emit");
            const connOutput = receivedOutputs.find(o => o && o[0] && o[0].topic === "connection/vantage/status");
            assert.ok(connOutput, "Connection status should be emitted on reception");

            const loadOutput = receivedOutputs.find(o => o && o[0] && o[0].topic === "120/load/vantage/status");
            assert.ok(loadOutput, "Output 1 (MQTT) should exist for load");
            const output1 = loadOutput[0];
            const output2 = loadOutput[1];

            const payload = JSON.parse(output1.payload);
            assert.strictEqual(payload.state, "ON");
            assert.strictEqual(payload.brightness, 255);

            assert.ok(output2, "Output 2 (Raw Vantage) should exist");
            assert.strictEqual(output2.topic, "vantage/raw/event");
            assert.strictEqual(output2.payload, "R:LOAD 120 100");
            console.log("  [PASS] Dual-output verified: Output 1 (MQTT JSON + connection/vantage/status) and Output 2 (Vantage Raw as-is)");

            // Test sending command from input
            receivedFromClient.length = 0;
            bridgeNode.emit("input", {
                topic: "120/load/vantage/set",
                payload: "OFF"
            });

            setTimeout(() => {
                assert.ok(receivedFromClient.includes("LOAD 120 0"), "Controller should receive LOAD 120 0");
                console.log("  [PASS] MQTT Input successfully compiled and sent to Vantage controller");

                // Test input filter: message with /status must be dropped (loop prevention)
                receivedFromClient.length = 0;
                bridgeNode.emit("input", {
                    topic: "120/load/vantage/status",
                    payload: "OFF"
                });

                // Test input filter: message without /vantage/ must be dropped
                bridgeNode.emit("input", {
                    topic: "120/load/other_system/set",
                    payload: "OFF"
                });

                setTimeout(() => {
                    assert.strictEqual(receivedFromClient.length, 0, "Messages matching /status or lacking /vantage/ must be filtered out");
                    console.log("  [PASS] Status loop prevention and topic validation filter verified");

                    // Test direct raw host command
                    bridgeNode.emit("input", {
                        payload: "RAMPLOAD 120 75 3.0"
                    });

                    setTimeout(() => {
                        assert.ok(receivedFromClient.includes("RAMPLOAD 120 75 3.0"), "Direct host command passed through");
                        console.log("  [PASS] Direct Host Command passed through cleanly");

                        // Close nodes
                        bridgeNode.emit("close", false, () => {
                            controllerNode.emit("close", () => {
                                server.close(() => {
                                    console.log("\nAll lifecycle and dual-output tests passed successfully!");
                                    process.exit(0);
                                });
                            });
                        });
                    }, 100);
                }, 100);
            }, 100);
        }, 100);
    }, 200);
});
